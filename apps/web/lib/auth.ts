import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { query } from './db';
import { verifyPassword } from './password';

// User type from database
interface DbUser {
  id: string;
  email: string;
  email_lower: string;
  password_hash: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean;
  last_login: Date | null;
}

// Check if users table exists (for graceful degradation)
async function checkUsersTableExists(): Promise<boolean> {
  try {
    const result = await query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'users'
      )`
    );
    return result.rows[0]?.exists ?? false;
  } catch {
    return false;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  debug: process.env.NODE_ENV === 'development',
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = String(credentials.email).toLowerCase();
        const password = String(credentials.password);

        try {
          const result = await query<DbUser>(
            'SELECT * FROM users WHERE email_lower = $1 AND is_active = true',
            [email]
          );

          const user = result.rows[0];

          if (!user || !user.password_hash) {
            return null;
          }

          const isValid = await verifyPassword(password, user.password_hash);

          if (!isValid) {
            return null;
          }

          // Update last_login
          await query('UPDATE users SET last_login = NOW() WHERE id = $1', [
            user.id,
          ]);

          return {
            id: user.id,
            email: user.email,
            name: user.full_name,
            role: user.role,
          };
        } catch (error) {
          console.error('Credentials auth error:', error);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      // For OAuth: create or update user in database
      if (account?.provider === 'google' && user.email) {
        const email = user.email;
        const emailLower = email.toLowerCase();

        try {
          // Check if users table exists
          const tableExists = await checkUsersTableExists();
          if (!tableExists) {
            console.warn('Users table does not exist. Run migration 006_add_users_table.sql');
            // Allow sign-in but skip database operations
            // User will get a temporary ID from the OAuth provider
            return true;
          }

          // Check if user exists
          const existingUser = await query<DbUser>(
            'SELECT id FROM users WHERE email_lower = $1',
            [emailLower]
          );

          if (existingUser.rows.length === 0) {
            // Create new user
            const result = await query<{ id: string }>(
              `INSERT INTO users (email, email_lower, full_name, role, is_active, last_login)
               VALUES ($1, $2, $3, 'user', true, NOW())
               RETURNING id`,
              [email, emailLower, user.name || profile?.name || null]
            );
            user.id = result.rows[0].id;
          } else {
            // Update last_login and get existing user ID
            await query(
              'UPDATE users SET last_login = NOW(), full_name = COALESCE(full_name, $1) WHERE email_lower = $2',
              [user.name || null, emailLower]
            );
            user.id = existingUser.rows[0].id;
          }
        } catch (error) {
          console.error('Error in signIn callback:', error);
          // Allow sign-in even if database fails - user just won't have persistent ID
          return true;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as unknown as { role?: string }).role || 'user';
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
});

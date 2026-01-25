import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Routes that require authentication
const protectedRoutes = [
  '/startups',
  '/patterns',
  '/trends',
  '/newsletter',
  '/watchlist',
  '/library',
];

// Routes that are always public (including main CTAs from marketing page)
const publicRoutes = ['/', '/login', '/register', '/api/auth', '/brief', '/dealbook', '/methodology', '/company'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Get the token using JWT
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isLoggedIn = !!token;

  // Check if this is a protected route
  const isProtectedRoute = protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  // Check if this is explicitly a public route
  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  // API routes (except auth) - let them through
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Static files and images - let them through
  if (pathname.includes('.')) {
    return NextResponse.next();
  }

  // Redirect to login if accessing protected route without auth
  if (isProtectedRoute && !isLoggedIn) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect to dashboard if accessing login while already logged in
  if ((pathname === '/login' || pathname === '/register') && isLoggedIn) {
    return NextResponse.redirect(new URL('/brief', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*$).*)',
  ],
};

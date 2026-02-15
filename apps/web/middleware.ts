import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

const AUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;

const AUTH_ROUTES = ['/watchlist', '/api/watchlist'];
const ADMIN_ROUTES = ['/monitoring', '/api/monitoring', '/api/editorial'];

function matchesRoute(path: string, route: string): boolean {
  return path === route || path.startsWith(`${route}/`);
}

export default async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  const isAdminRoute = ADMIN_ROUTES.some((route) => matchesRoute(path, route));
  const isAuthRoute = isAdminRoute || AUTH_ROUTES.some((route) => matchesRoute(path, route));

  if (!isAuthRoute) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: AUTH_SECRET });

  if (!token) {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', `${req.nextUrl.pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  if (isAdminRoute) {
    const role = (token as unknown as { role?: string }).role;
    if (role !== 'admin') {
      if (path.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const homeUrl = new URL('/', req.nextUrl.origin);
      homeUrl.searchParams.set('forbidden', '1');
      return NextResponse.redirect(homeUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/watchlist/:path*',
    '/api/watchlist/:path*',
    '/monitoring/:path*',
    '/api/monitoring/:path*',
    '/api/editorial/:path*',
  ],
};

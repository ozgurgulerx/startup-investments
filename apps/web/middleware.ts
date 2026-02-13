import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED_ROUTES = ['/watchlist', '/monitoring', '/api/monitoring', '/api/editorial'];

function hasSessionCookie(req: NextRequest): boolean {
  return Boolean(
    req.cookies.get('authjs.session-token') ||
    req.cookies.get('__Secure-authjs.session-token') ||
    req.cookies.get('next-auth.session-token') ||
    req.cookies.get('__Secure-next-auth.session-token')
  );
}

export default function middleware(req: NextRequest) {
  const isAuthenticated = hasSessionCookie(req);
  const path = req.nextUrl.pathname;

  const isProtectedRoute = PROTECTED_ROUTES.some(
    (route) => path === route || path.startsWith(`${route}/`)
  );

  if (isProtectedRoute && !isAuthenticated) {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/watchlist/:path*',
    '/monitoring/:path*',
    '/api/monitoring/:path*',
    '/api/editorial/:path*',
  ],
};

import { NextResponse, type NextRequest } from 'next/server';

/**
 * Two jobs:
 *
 *  1. Publish the current path as a header so the server-rendered navigation
 *     rail can highlight the active item without becoming a client component.
 *  2. Origin checking for state-changing requests. Server Actions arrive as
 *     POSTs to the page URL, so a cross-site POST is refused here before it
 *     reaches any action. Better Auth does its own CSRF checks on top.
 *
 * Applicant-facing pages are excluded from the origin check only for GETs.
 */
export function middleware(request: NextRequest) {
  const method = request.method.toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin');
    // Provider webhooks are authenticated by signature, not by origin, and
    // never carry one.
    const isWebhook = request.nextUrl.pathname.startsWith('/api/webhooks/');
    if (!isWebhook && origin) {
      const allowed = new Set(
        [
          process.env.PUBLIC_APP_URL,
          process.env.BETTER_AUTH_URL,
          ...(process.env.TRUSTED_ORIGINS ?? '').split(',').map((s) => s.trim()),
        ].filter(Boolean) as string[],
      );
      if (!allowed.has(origin)) {
        return new NextResponse('Cross-origin request refused.', { status: 403 });
      }
    }
  }

  // Forward the path on the REQUEST headers, which is what a server component
  // sees through next/headers.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

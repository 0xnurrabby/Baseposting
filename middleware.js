export const config = {
  matcher: '/:path*',
};

export default function middleware(request) {
  const url = new URL(request.url);

  const maintenanceMode = process.env.MAINTENANCE_MODE === 'true';
  const bypassKey = process.env.MAINTENANCE_BYPASS_KEY || '';

  const keyFromUrl = url.searchParams.get('key');
  const cookies = request.headers.get('cookie') || '';
  const hasBypassCookie = cookies.includes('maint_bypass=1');

  if (!maintenanceMode) {
    return;
  }

  if (
    url.pathname === '/maintenance.html' ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/.well-known/') ||
    url.pathname === '/favicon.ico' ||
    url.pathname === '/builder-attribution.js'
  ) {
    return;
  }

  if (hasBypassCookie) {
    return;
  }

  if (bypassKey && keyFromUrl === bypassKey) {
    const cleanUrl = new URL(request.url);
    cleanUrl.searchParams.delete('key');

    return new Response(null, {
      status: 302,
      headers: {
        Location: cleanUrl.toString(),
        'Set-Cookie': 'maint_bypass=1; Path=/; Max-Age=7200; HttpOnly; Secure; SameSite=Lax',
      },
    });
  }

  return Response.redirect(new URL('/maintenance.html', request.url), 307);
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("auth_token")?.value;
  const role = request.cookies.get("user_role")?.value;

  // Protect Admin routes: Only users with role === 'admin' can enter
  if (pathname.startsWith("/admin")) {
    if (!token) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
    // If authenticated as standard user, redirect away from admin console to user portal
    if (role === "user") {
      const portalUrl = new URL("/portal", request.url);
      portalUrl.searchParams.set("error", "admin_required");
      return NextResponse.redirect(portalUrl);
    }
  }

  // Protect User Portal routes: Admins are directed exclusively to the Admin Console
  if (pathname.startsWith("/portal")) {
    if (token && role === "admin") {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/portal/:path*"],
};

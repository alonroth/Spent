import { NextResponse, type NextRequest } from "next/server";

/**
 * Network boundary for Spent's local API.
 *
 * Loopback binding keeps remote machines out, while this proxy rejects DNS
 * rebinding hostnames and cross-site browser requests that can still target a
 * service on 127.0.0.1.
 */

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LOOPBACK_HOSTNAMES = new Set([
  "127.0.0.1",
  "::1",
  "localhost",
  "spent.localhost",
]);

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function parseAllowedHost(value: string | null): URL | null {
  if (!value || /[\\/@\s]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    return LOOPBACK_HOSTNAMES.has(normalizeHostname(parsed.hostname))
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function requestSourceMatchesHost(
  value: string | null,
  allowedHost: URL
): boolean {
  if (!value) return false;
  try {
    const source = new URL(value);
    return (
      (source.protocol === "http:" || source.protocol === "https:") &&
      LOOPBACK_HOSTNAMES.has(normalizeHostname(source.hostname)) &&
      source.host.toLowerCase() === allowedHost.host.toLowerCase()
    );
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const allowedHost = parseAllowedHost(request.headers.get("host"));
  if (!allowedHost) {
    return new NextResponse("Forbidden: invalid local host", { status: 403 });
  }

  // Browsers provide Sec-Fetch-Site and scripts cannot forge it. Native health
  // checks and the local menu-bar client may omit it, so absence is accepted.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return new NextResponse("Forbidden: cross-site request blocked", {
      status: 403,
    });
  }

  if (!MUTATING_METHODS.has(request.method)) {
    return NextResponse.next();
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (!origin && !referer) {
    return new NextResponse("Forbidden: missing origin/referer", {
      status: 403,
    });
  }

  if (origin && !requestSourceMatchesHost(origin, allowedHost)) {
    return new NextResponse("Forbidden: cross-origin request blocked", {
      status: 403,
    });
  }
  if (!origin && referer && !requestSourceMatchesHost(referer, allowedHost)) {
    return new NextResponse("Forbidden: cross-origin referer", {
      status: 403,
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};

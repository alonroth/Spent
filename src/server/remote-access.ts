import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getGlobalSetting, setGlobalSetting } from "@/server/db/queries/settings";

const UPSTREAM_HOST = "127.0.0.1";
const configuredUpstreamPort = Number(process.env.SPENT_UPSTREAM_PORT ?? 41234);
const UPSTREAM_PORT = Number.isInteger(configuredUpstreamPort) && configuredUpstreamPort > 0 && configuredUpstreamPort < 65_536
  ? configuredUpstreamPort
  : 41234;
const REMOTE_PORT = 41235;
const PASSWORD_ITERATIONS = 310_000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_CSRF_TTL_MS = 10 * 60 * 1000;
const MAX_LOGIN_BODY_BYTES = 4 * 1024;
const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

const ENABLED_KEY = "remote_access_enabled";
const HOST_KEY = "remote_access_host";
const PASSWORD_KEY = "remote_access_password_hash";
const CERT_DIR_KEY = "remote_access_cert_dir";

const SESSION_COOKIE = "__Host-spent_session";
const LOGIN_CSRF_COOKIE = "spent_remote_login_csrf";
const LOOPBACK_UPSTREAM_HOST = "spent.localhost";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Session = { expiresAt: number };
type LoginAttempt = { failures: number; blockedUntil: number };

let boundary: https.Server | null = null;
let boundaryHost: string | null = null;
const sessions = new Map<string, Session>();
const loginCsrf = new Map<string, number>();
const loginAttempts = new Map<string, LoginAttempt>();

export interface RemoteAccessStatus {
  enabled: boolean;
  configured: boolean;
  running: boolean;
  host: string | null;
  port: number;
  url: string | null;
  certificateUrl: string | null;
}

function dataDirectory(): string {
  return path.resolve(process.env.SPENT_DATA_DIR ?? path.join(process.cwd(), "data"));
}

function certificatePaths(): { key: string; cert: string; host: string } {
  const dir = dataDirectory();
  return {
    key: path.join(dir, ".remote-access-key.pem"),
    cert: path.join(dir, ".remote-access-cert.pem"),
    host: path.join(dir, ".remote-access-cert-host"),
  };
}

function isPrivateIPv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function privateIPv4Interfaces(): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isPrivateIPv4(entry.address)) {
        addresses.push(entry.address);
      }
    }
  }
  return [...new Set(addresses)].sort();
}

function configuredHost(): string | null {
  const stored = getGlobalSetting(HOST_KEY);
  return stored && isPrivateIPv4(stored) ? stored : null;
}

function currentPrivateHost(): string | null {
  return privateIPv4Interfaces()[0] ?? null;
}

function isEnabled(): boolean {
  return getGlobalSetting(ENABLED_KEY) === "true";
}

function hasPassword(): boolean {
  return Boolean(getGlobalSetting(PASSWORD_KEY));
}

function certDirectorySetting(): string {
  return getGlobalSetting(CERT_DIR_KEY) ?? dataDirectory();
}

function ensureCertificate(host: string): { key: string; cert: string } {
  const dir = certDirectorySetting();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const paths = certificatePaths();
  const storedHost = fs.existsSync(paths.host)
    ? fs.readFileSync(paths.host, "utf8").trim()
    : "";

  if (!fs.existsSync(paths.key) || !fs.existsSync(paths.cert) || storedHost !== host) {
    try {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-sha256",
          "-nodes",
          "-days",
          "825",
          "-keyout",
          paths.key,
          "-out",
          paths.cert,
          "-subj",
          "/CN=Spent Local Access",
          "-addext",
          `subjectAltName=IP:${host}`,
        ],
        { stdio: ["ignore", "ignore", "ignore"] }
      );
      fs.writeFileSync(paths.host, host, { mode: 0o600 });
    } catch {
      throw new Error("Secure LAN access could not create its local certificate");
    }
  }

  try {
    fs.chmodSync(paths.key, 0o600);
    fs.chmodSync(paths.cert, 0o600);
    fs.chmodSync(paths.host, 0o600);
  } catch {
    throw new Error("Secure LAN access certificate permissions are unsafe");
  }
  return { key: paths.key, cert: paths.cert };
}

function passwordHash(password: string, salt: Buffer, iterations = PASSWORD_ITERATIONS): Buffer {
  return crypto.pbkdf2Sync(password, salt, iterations, 64, "sha512");
}

function makePasswordVerifier(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = passwordHash(password, salt);
  return `pbkdf2-sha512$${PASSWORD_ITERATIONS}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password: string, verifier: string | null): boolean {
  if (!verifier) return false;
  const [, algorithm, rawIterations, saltHex, hashHex] = verifier.match(
    /^pbkdf2-(sha512)\$(\d+)\$([0-9a-f]{32})\$([0-9a-f]{128})$/i
  ) ?? [];
  if (algorithm !== "sha512" || !rawIterations || !saltHex || !hashHex) return false;
  const iterations = Number(rawIterations);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  const actual = passwordHash(password, Buffer.from(saltHex, "hex"), iterations);
  return crypto.timingSafeEqual(actual, expected);
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cookieValue(request: http.IncomingMessage, name: string): string | null {
  const header = request.headers.cookie ?? "";
  for (const item of header.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function remoteAddress(request: http.IncomingMessage): string {
  return (request.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
}

function expectedHost(host: string): string {
  return `${host}:${REMOTE_PORT}`;
}

function requestHasValidHost(request: http.IncomingMessage, host: string): boolean {
  return request.headers.host?.toLowerCase() === expectedHost(host).toLowerCase();
}

function requestSourceMatches(request: http.IncomingMessage, host: string): boolean {
  const expected = `https://${expectedHost(host)}`;
  const origin = request.headers.origin;
  const referer = request.headers.referer;
  return (
    (origin === expected || origin === `${expected}/`) ||
    (!origin && (referer === expected || referer?.startsWith(`${expected}/`) === true))
  );
}

function fetchMetadataAllows(request: http.IncomingMessage): boolean {
  const site = request.headers["sec-fetch-site"];
  return !site || site === "same-origin" || site === "none";
}

function commonHeaders(): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000",
  };
}

function sendText(response: http.ServerResponse, status: number, text: string, extra?: Record<string, string | string[]>): void {
  response.writeHead(status, { ...commonHeaders(), "Content-Type": "text/plain; charset=utf-8", ...extra });
  response.end(text);
}

function sendLoginPage(response: http.ServerResponse, csrf: string, host: string, message?: string): void {
  const escapedHost = host.replace(/[^0-9.]/g, "");
  const escapedMessage = message ? `<p class="error">${message}</p>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spent · Local access</title><style>body{font:16px system-ui,sans-serif;background:#f7f3ed;color:#29231e;display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem}.card{max-width:25rem;width:100%;background:white;border:1px solid #ded6cc;border-radius:1rem;padding:2rem;box-sizing:border-box;box-shadow:0 12px 40px #513d2414}h1{font-family:Georgia,serif;font-weight:400;margin:0 0 .5rem}p{line-height:1.5;color:#665d55}.warning{font-size:.9rem;background:#fff5df;border-radius:.6rem;padding:.75rem}.error{color:#a33b2c;font-weight:600}label{display:block;font-size:.85rem;margin:.75rem 0 .35rem}input{width:100%;box-sizing:border-box;border:1px solid #cfc5ba;border-radius:.5rem;padding:.7rem;font:inherit}button{margin-top:1.2rem;width:100%;border:0;border-radius:.5rem;padding:.75rem;background:#32271e;color:white;font:inherit;font-weight:600;cursor:pointer}a{color:#69513b}</style></head><body><main class="card"><h1>Spent</h1><p>Secure local access / גישה מקומית מאובטחת</p>${escapedMessage}<p class="warning">This page is only for your trusted home Wi‑Fi. Disable LAN access before using public Wi‑Fi.</p><form method="post" action="/__spent/remote/login"><input type="hidden" name="csrf" value="${csrf}"><label for="password">Access password / סיסמת גישה</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Log in / כניסה</button></form><p><a href="/__spent/remote/certificate">Download the local certificate</a> for phone trust setup.</p><p>https://${escapedHost}:${REMOTE_PORT}</p></main></body></html>`;
  response.writeHead(200, {
    ...commonHeaders(),
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Content-Length": Buffer.byteLength(html),
    "Set-Cookie": `${LOGIN_CSRF_COOKIE}=${encodeURIComponent(csrf)}; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Strict`,
  });
  response.end(html);
}

function issueLoginCsrf(): string {
  const csrf = crypto.randomBytes(32).toString("hex");
  loginCsrf.set(tokenHash(csrf), Date.now() + LOGIN_CSRF_TTL_MS);
  return csrf;
}

function cleanupEphemeralState(): void {
  const now = Date.now();
  for (const [key, value] of sessions) if (value.expiresAt <= now) sessions.delete(key);
  for (const [key, expiresAt] of loginCsrf) if (expiresAt <= now) loginCsrf.delete(key);
  for (const [key, value] of loginAttempts) {
    if (value.blockedUntil <= now && value.failures === 0) loginAttempts.delete(key);
  }
}

function currentSession(request: http.IncomingMessage): string | null {
  cleanupEphemeralState();
  const raw = cookieValue(request, SESSION_COOKIE);
  if (!raw) return null;
  const key = tokenHash(raw);
  const session = sessions.get(key);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(key);
    return null;
  }
  return key;
}

function parseFormBody(request: http.IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_LOGIN_BODY_BYTES) {
        reject(new Error("request too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
    request.on("error", reject);
  });
}

function loginAttemptAllowed(ip: string): { allowed: boolean; retryAfter: number } {
  const attempt = loginAttempts.get(ip);
  if (!attempt || attempt.blockedUntil <= Date.now()) return { allowed: true, retryAfter: 0 };
  return { allowed: false, retryAfter: Math.ceil((attempt.blockedUntil - Date.now()) / 1000) };
}

function recordLoginFailure(ip: string): void {
  const previous = loginAttempts.get(ip) ?? { failures: 0, blockedUntil: 0 };
  const failures = previous.failures + 1;
  loginAttempts.set(ip, {
    failures: failures >= MAX_LOGIN_FAILURES ? 0 : failures,
    blockedUntil: failures >= MAX_LOGIN_FAILURES ? Date.now() + LOCKOUT_MS : 0,
  });
}

function recordLoginSuccess(ip: string): void {
  loginAttempts.delete(ip);
}

function safeRedirectLocation(value: string | string[] | undefined, host: string): string | undefined {
  if (!value || Array.isArray(value)) return undefined;
  if (value.startsWith("/")) return value;
  try {
    const parsed = new URL(value);
    if (parsed.hostname === LOOPBACK_UPSTREAM_HOST || parsed.hostname === UPSTREAM_HOST) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Drop malformed redirect locations.
  }
  return `https://${expectedHost(host)}/`;
}

function forwardedHeaders(request: http.IncomingMessage, host: string): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (["connection", "host", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"].includes(key)) continue;
    if (value !== undefined) headers[key] = value;
  }
  if (typeof headers.cookie === "string") {
    headers.cookie = headers.cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => !part.startsWith(`${SESSION_COOKIE}=`) && !part.startsWith(`${LOGIN_CSRF_COOKIE}=`))
      .join("; ");
  }
  headers.host = `${LOOPBACK_UPSTREAM_HOST}:${UPSTREAM_PORT}`;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-host"] = expectedHost(host);
  if (request.headers.origin) headers.origin = `http://${LOOPBACK_UPSTREAM_HOST}:${UPSTREAM_PORT}`;
  if (request.headers.referer) {
    try {
      const referer = new URL(request.headers.referer);
      headers.referer = `http://${LOOPBACK_UPSTREAM_HOST}:${UPSTREAM_PORT}${referer.pathname}${referer.search}`;
    } catch {
      delete headers.referer;
    }
  }
  return headers;
}

function proxyToLoopback(request: http.IncomingMessage, response: http.ServerResponse, host: string): void {
  const upstream = http.request(
    {
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: request.method,
      path: request.url,
      headers: forwardedHeaders(request, host),
      timeout: 30_000,
    },
    (upstreamResponse) => {
      const responseHeaders: http.OutgoingHttpHeaders = {};
      for (const [key, value] of Object.entries(upstreamResponse.headers)) {
        if (["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"].includes(key)) continue;
        responseHeaders[key] = value;
      }
      const location = safeRedirectLocation(responseHeaders.location, host);
      if (location) responseHeaders.location = location;
      else delete responseHeaders.location;
      responseHeaders["x-content-type-options"] = "nosniff";
      responseHeaders["x-frame-options"] = "DENY";
      response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
      upstreamResponse.pipe(response);
    }
  );
  upstream.on("timeout", () => upstream.destroy());
  upstream.on("error", () => {
    if (!response.headersSent) sendText(response, 502, "Spent is unavailable");
    else response.destroy();
  });
  request.pipe(upstream);
}

async function handleRemoteRequest(request: http.IncomingMessage, response: http.ServerResponse, host: string): Promise<void> {
  if (!requestHasValidHost(request, host)) {
    sendText(response, 403, "Forbidden: invalid local access host");
    return;
  }
  if (!fetchMetadataAllows(request)) {
    sendText(response, 403, "Forbidden: cross-site request blocked");
    return;
  }

  const url = new URL(request.url ?? "/", `https://${expectedHost(host)}`);
  const ip = remoteAddress(request);

  if (url.pathname === "/__spent/remote/certificate" && request.method === "GET") {
    try {
      const { cert } = ensureCertificate(host);
      const der = execFileSync("openssl", ["x509", "-in", cert, "-outform", "der"], { stdio: ["ignore", "pipe", "ignore"] });
      response.writeHead(200, {
        ...commonHeaders(),
        "Content-Type": "application/x-x509-ca-cert",
        "Content-Disposition": 'attachment; filename="spent-local-access.cer"',
        "Content-Length": der.length,
      });
      response.end(der);
    } catch {
      sendText(response, 503, "Certificate unavailable");
    }
    return;
  }

  if (url.pathname === "/__spent/remote/login" && request.method === "GET") {
    sendLoginPage(response, issueLoginCsrf(), host);
    return;
  }

  if (url.pathname === "/__spent/remote/login" && request.method === "POST") {
    if (!requestSourceMatches(request, host)) {
      sendText(response, 403, "Forbidden: cross-origin login blocked");
      return;
    }
    const limit = loginAttemptAllowed(ip);
    if (!limit.allowed) {
      sendText(response, 429, "Too many failed attempts", { "Retry-After": String(limit.retryAfter) });
      return;
    }
    try {
      const form = await parseFormBody(request);
      const csrf = form.get("csrf") ?? "";
      const csrfKey = tokenHash(csrf);
      const csrfExpiry = loginCsrf.get(csrfKey);
      loginCsrf.delete(csrfKey);
      const password = form.get("password") ?? "";
      if (!csrfExpiry || csrfExpiry <= Date.now() || !verifyPassword(password, getGlobalSetting(PASSWORD_KEY))) {
        recordLoginFailure(ip);
        sendLoginPage(response, issueLoginCsrf(), host, "The password or login form was not accepted.");
        return;
      }
      recordLoginSuccess(ip);
      const token = crypto.randomBytes(32).toString("base64url");
      sessions.set(tokenHash(token), { expiresAt: Date.now() + SESSION_TTL_MS });
      response.writeHead(303, {
        ...commonHeaders(),
        Location: "/",
        "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Strict`,
      });
      response.end();
    } catch {
      sendText(response, 400, "Invalid login request");
    }
    return;
  }

  const sessionKey = currentSession(request);
  if (url.pathname === "/__spent/remote/logout") {
    if (request.method !== "POST") {
      sendText(response, 405, "Method not allowed", { Allow: "POST" });
      return;
    }
    if (!sessionKey || !requestSourceMatches(request, host)) {
      sendText(response, 403, "Forbidden: logout blocked");
      return;
    }
    sessions.delete(sessionKey);
    response.writeHead(303, {
      ...commonHeaders(),
      Location: "/__spent/remote/login",
      "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    });
    response.end();
    return;
  }

  if (!sessionKey) {
    response.writeHead(303, { ...commonHeaders(), Location: "/__spent/remote/login" });
    response.end();
    return;
  }

  if (MUTATING_METHODS.has(request.method ?? "") && !requestSourceMatches(request, host)) {
    sendText(response, 403, "Forbidden: cross-origin request blocked");
    return;
  }

  proxyToLoopback(request, response, host);
}

async function startRemoteAccess(host: string): Promise<void> {
  if (boundary && boundaryHost === host) return;
  if (boundary) stopRemoteAccess();
  const certificate = ensureCertificate(host);
  const server = https.createServer(
    { key: fs.readFileSync(certificate.key), cert: fs.readFileSync(certificate.cert), minVersion: "TLSv1.2" },
    (request, response) => {
      void handleRemoteRequest(request, response, host);
    }
  );
  server.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(REMOTE_PORT, host);
  });
  boundary = server;
  boundaryHost = host;
}

export function stopRemoteAccess(): void {
  const server = boundary;
  boundary = null;
  boundaryHost = null;
  sessions.clear();
  if (server) {
    server.close();
    server.closeAllConnections?.();
  }
}

export async function configureRemoteAccess(input: {
  enabled: boolean;
  password?: string;
  passwordConfirmation?: string;
}): Promise<void> {
  if (!input.enabled) {
    setGlobalSetting(ENABLED_KEY, "false");
    stopRemoteAccess();
    return;
  }

  if (typeof input.password !== "string" || input.password.length < 12 || input.password.length > 200) {
    throw new Error("A unique access password of at least 12 characters is required");
  }
  if (input.password !== input.passwordConfirmation) {
    throw new Error("Access passwords do not match");
  }

  // An explicit re-enable re-detects the current private interface, so a
  // changed home-router lease can be recovered without editing the database.
  const host = currentPrivateHost() ?? configuredHost();
  if (!host) {
    throw new Error("No private home-network IPv4 address is available");
  }

  setGlobalSetting(PASSWORD_KEY, makePasswordVerifier(input.password));
  setGlobalSetting(HOST_KEY, host);
  setGlobalSetting(CERT_DIR_KEY, dataDirectory());
  setGlobalSetting(ENABLED_KEY, "true");
  // A password change must invalidate every phone/browser session immediately.
  sessions.clear();
  loginCsrf.clear();
  try {
    await startRemoteAccess(host);
  } catch {
    setGlobalSetting(ENABLED_KEY, "false");
    stopRemoteAccess();
    throw new Error("Secure LAN access could not be started; it remains disabled");
  }
}

export async function startRemoteAccessIfEnabled(): Promise<void> {
  if (!isEnabled()) return;
  const host = configuredHost();
  if (!host || !hasPassword()) throw new Error("Secure LAN access configuration is incomplete");
  await startRemoteAccess(host);
}

export function getRemoteAccessStatus(): RemoteAccessStatus {
  const enabled = isEnabled();
  const host = boundaryHost ?? configuredHost();
  const running = Boolean(boundary && boundary.listening && host);
  const url = enabled && running && host ? `https://${expectedHost(host)}` : null;
  return {
    enabled,
    configured: hasPassword() && Boolean(configuredHost()),
    running,
    host: enabled ? host : null,
    port: REMOTE_PORT,
    url,
    certificateUrl: url ? `${url}/__spent/remote/certificate` : null,
  };
}

/**
 * Vendasta OAuth2 — 2-legged JWT bearer assertion flow
 *
 * Reads a service-account key file (JSON with private_key, client_email, kid, token_uri)
 * Signs an RS256 JWT assertion, exchanges it for a bearer token.
 */

import jwt from "jsonwebtoken";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VendastaCredentials {
  private_key: string;
  client_email: string;
  kid: string;
  token_uri: string;          // e.g. https://sso-api-prod.apigateway.co/oauth2/token
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ── Token cache ──────────────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiry = 0;

const AUDIENCE = "https://iam-prod.apigateway.co";

// Default scopes covering the most common API surfaces
const DEFAULT_SCOPES = [
  "business",
  "business:read",
  "order",
  "order:read",
  "sales.account",
  "sales.contact",
  "user.profile:read",
  "user.list",
  "crm",
  "crm:read",
  "crm.schema:read",
  "social",
  "social:read",
  "reputation",
  "reputation:read",
  "knowledge",
  "knowledge:read",
  "conversation",
  "conversation:read",
  "profile",
  "email",
].join(" ");

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildAssertion(creds: VendastaCredentials, scopes: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: creds.client_email,
    sub: creds.client_email,
    aud: AUDIENCE,
    iat: now,
    exp: now + 600,           // 10 min — Vendasta recommended max
    scope: scopes,
  };
  return jwt.sign(payload, creds.private_key, {
    algorithm: "RS256",
    header: { alg: "RS256", kid: creds.kid, typ: "JWT" },
  });
}

export async function getAccessToken(
  creds: VendastaCredentials,
  scopes?: string,
): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry - 30_000) return cachedToken;

  const assertion = buildAssertion(creds, scopes ?? DEFAULT_SCOPES);

  const res = await fetch(creds.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vendasta token error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as TokenResponse;
  cachedToken = data.access_token;
  tokenExpiry = now + data.expires_in * 1000;
  return cachedToken;
}
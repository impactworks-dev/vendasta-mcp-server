/**
 * Thin Vendasta HTTP client — handles auth header injection,
 * JSON serialization, and basic error normalization.
 */

import { getAccessToken, type VendastaCredentials } from "./auth.js";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE" | "PUT";

export interface RequestOptions {
  method?: HttpMethod;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}

export class VendastaClient {
  private baseUrl: string;

  constructor(
    private creds: VendastaCredentials,
    env: "prod" | "demo" = "prod",
  ) {
    this.baseUrl =
      env === "prod"
        ? "https://prod.apigateway.co"
        : "https://demo.apigateway.co";
  }

  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    const token = await getAccessToken(this.creds);
    const url = new URL(opts.path, this.baseUrl);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method: opts.method ?? "POST",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Vendasta API ${res.status} ${opts.method ?? "POST"} ${opts.path}: ${text}`,
      );
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  /** Shorthand for the legacy v1 marketplace endpoints */
  async legacyGet<T = unknown>(path: string, query?: Record<string, string>): Promise<T> {
    const token = await getAccessToken(this.creds);
    const url = new URL(path, "https://prod.apigateway.co");
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Vendasta Legacy API ${res.status}: ${text}`);
    try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
  }
}
#!/usr/bin/env node
/**
 * vendasta-mcp-server — Remote (Streamable HTTP) entrypoint
 *
 * Deploys as a stateless HTTP server for Fly.io, Railway, or any container host.
 * ClickUp Super Agents and other remote MCP clients connect here.
 *
 * Credentials can be provided two ways:
 *   1. VENDASTA_CREDENTIALS_PATH  — path to the JSON key file (local dev)
 *   2. VENDASTA_CREDENTIALS_JSON  — the JSON key file contents as a string (Fly secrets)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { VendastaClient } from "./client.js";
import type { VendastaCredentials } from "./auth.js";

// ── Credential loading ───────────────────────────────────────────────────────

function loadCredentials(): VendastaCredentials {
  // Option 1: JSON string in env (Fly secrets)
  const jsonEnv = process.env.VENDASTA_CREDENTIALS_JSON;
  if (jsonEnv) {
    return JSON.parse(jsonEnv) as VendastaCredentials;
  }

  // Option 2: File path
  const filePath = process.env.VENDASTA_CREDENTIALS_PATH;
  if (filePath) {
    return JSON.parse(readFileSync(filePath, "utf-8")) as VendastaCredentials;
  }

  console.error(
    "Set VENDASTA_CREDENTIALS_JSON (recommended for Fly) or VENDASTA_CREDENTIALS_PATH.",
  );
  process.exit(1);
}

const creds = loadCredentials();
const env = (process.env.VENDASTA_ENV ?? "prod") as "prod" | "demo";
const api = new VendastaClient(creds, env);

// ── Server factory ─────────────────────────────────────────────────────────
// Each HTTP request gets a fresh McpServer + transport pair (stateless).

function buildServer(): McpServer {
  const server = new McpServer({ name: "vendasta", version: "1.0.0" });

  // ── 1. Accounts ──────────────────────────────────────────────────────────

  server.tool(
    "list_accounts",
    "List business accounts (locations). Supports cursor pagination.",
    {
      pageSize: z.number().min(1).max(100).optional(),
      cursor: z.string().optional(),
      searchTerm: z.string().optional(),
    },
    async ({ pageSize, cursor, searchTerm }) => {
      const body: Record<string, unknown> = {};
      if (pageSize) body.pageSize = pageSize;
      if (cursor) body.cursor = cursor;
      if (searchTerm) body.searchTerm = searchTerm;
      const data = await api.request({ path: "/grpc/v1/business/list", body });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool("get_account", "Get a business account by AG-xxx ID.", {
    accountId: z.string(),
  }, async ({ accountId }) => {
    const data = await api.request({ path: "/grpc/v1/business/get", body: { accountId } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("create_account", "Create a new business account.", {
    companyName: z.string(), address: z.string().optional(), city: z.string().optional(),
    state: z.string().optional(), zip: z.string().optional(), country: z.string().optional(),
    phone: z.string().optional(), website: z.string().optional(),
    contactFirstName: z.string().optional(), contactLastName: z.string().optional(),
    contactEmail: z.string().optional(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/business/create", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("update_account", "Update fields on a business account.", {
    accountId: z.string(), companyName: z.string().optional(), address: z.string().optional(),
    city: z.string().optional(), state: z.string().optional(), zip: z.string().optional(),
    country: z.string().optional(), phone: z.string().optional(), website: z.string().optional(),
    contactFirstName: z.string().optional(), contactLastName: z.string().optional(),
    contactEmail: z.string().optional(),
  }, async ({ accountId, ...fields }) => {
    const data = await api.request({ path: "/grpc/v1/business/update", body: { accountId, ...fields } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ── 2. CRM ───────────────────────────────────────────────────────────────

  server.tool("crm_list_field_schemas", "List CRM field schemas for a namespace.", {
    namespace: z.string(), crmObjectType: z.enum(["Contact", "Company", "Activity", "CustomObject"]).optional(),
    pageSize: z.number().optional(), cursor: z.string().optional(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/crm/field-schema/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("crm_list_records", "List CRM records with optional filters.", {
    namespace: z.string(),
    resourceType: z.enum(["contacts", "companies", "activities", "customobjects"]),
    filters: z.array(z.object({ id: z.string(), value: z.unknown(), operation: z.string().optional() })).optional(),
    returnFields: z.array(z.string()).optional(),
    pageSize: z.number().optional(), cursor: z.string().optional(),
  }, async ({ namespace, resourceType, filters, returnFields, pageSize, cursor }) => {
    const body: Record<string, unknown> = {};
    if (filters) body.fields = filters;
    if (returnFields) body.returnFields = returnFields;
    if (pageSize) body.pageSize = pageSize;
    if (cursor) body.cursor = cursor;
    const data = await api.request({ path: `/org/list/${namespace}/${resourceType}`, body });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("crm_upsert_record", "Create or update a CRM record with dedup.", {
    namespace: z.string(),
    resourceType: z.enum(["contacts", "companies", "activities", "customobjects"]),
    fields: z.array(z.object({ id: z.string(), value: z.unknown(), operation: z.string().optional() })),
    searchExisting: z.array(z.object({ id: z.string(), value: z.unknown() })).optional(),
    associations: z.array(z.object({ id: z.string(), type: z.string(), subtype: z.string().optional() })).optional(),
  }, async ({ namespace, resourceType, fields, searchExisting, associations }) => {
    const body: Record<string, unknown> = { fields };
    if (searchExisting) body.searchExisting = searchExisting;
    if (associations) {
      body.contact_associations = associations.filter(a => a.type === "Contact");
      body.company_associations = associations.filter(a => a.type === "Company");
      body.activity_associations = associations.filter(a => a.type === "Activity");
    }
    const data = await api.request({ method: "PATCH", path: `/org/${namespace}/${resourceType}`, body });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("crm_delete_record", "Delete a CRM record by ID.", {
    namespace: z.string(),
    resourceType: z.enum(["contacts", "companies", "activities", "customobjects"]),
    recordId: z.string(),
  }, async ({ namespace, resourceType, recordId }) => {
    const data = await api.request({ method: "DELETE", path: `/org/${namespace}/${resourceType}/${recordId}` });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ── 3. Reputation ────────────────────────────────────────────────────────

  server.tool("reputation_list_reviews", "List reviews for an account.", {
    accountId: z.string(), pageSize: z.number().optional(), cursor: z.string().optional(),
    minRating: z.number().min(1).max(5).optional(), maxRating: z.number().min(1).max(5).optional(),
    source: z.string().optional(),
  }, async ({ accountId, pageSize, cursor, minRating, maxRating, source }) => {
    const body: Record<string, unknown> = { accountId };
    if (pageSize) body.pageSize = pageSize; if (cursor) body.cursor = cursor;
    if (minRating) body.minRating = minRating; if (maxRating) body.maxRating = maxRating;
    if (source) body.source = source;
    const data = await api.request({ path: "/grpc/v1/reputation/reviews/list", body });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("reputation_get_summary", "Get reputation summary for an account.", {
    accountId: z.string(),
  }, async ({ accountId }) => {
    const data = await api.request({ path: "/grpc/v1/reputation/summary/get", body: { accountId } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("reputation_reply_to_review", "Reply to a review.", {
    accountId: z.string(), reviewId: z.string(), replyText: z.string(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/reputation/reviews/reply", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ── 4. Sales Orders ──────────────────────────────────────────────────────

  server.tool("sales_list_orders", "List sales orders.", {
    accountId: z.string().optional(), status: z.string().optional(),
    pageSize: z.number().optional(), cursor: z.string().optional(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/sales-orders/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("sales_get_order", "Get a sales order.", { orderId: z.string() }, async ({ orderId }) => {
    const data = await api.request({ path: "/grpc/v1/sales-orders/get", body: { orderId } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("sales_create_order", "Create a sales order.", {
    accountId: z.string(),
    lineItems: z.array(z.object({ productId: z.string(), quantity: z.number().optional(), customPrice: z.number().optional() })),
  }, async ({ accountId, lineItems }) => {
    const data = await api.request({ path: "/grpc/v1/sales-orders/create", body: { accountId, lineItems } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ── 5. Conversations ─────────────────────────────────────────────────────

  server.tool("conversation_list", "List conversations for an account.", {
    accountId: z.string(), pageSize: z.number().optional(), cursor: z.string().optional(),
    channel: z.string().optional(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/conversation/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("conversation_get_messages", "Get messages in a conversation.", {
    conversationId: z.string(), pageSize: z.number().optional(), cursor: z.string().optional(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/conversation/messages/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("conversation_send_message", "Send a message in a conversation.", {
    conversationId: z.string(), message: z.string(), channel: z.string().optional(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/conversation/messages/send", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ── 6. Social ────────────────────────────────────────────────────────────

  server.tool("social_list_posts", "List social posts for an account.", {
    accountId: z.string(), pageSize: z.number().optional(), cursor: z.string().optional(),
    startDate: z.string().optional(), endDate: z.string().optional(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/social-posts/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("social_create_draft", "Create a social media draft.", {
    accountId: z.string(), text: z.string(), platforms: z.array(z.string()),
    scheduledTime: z.string().optional(), mediaUrls: z.array(z.string()).optional(),
  }, async ({ accountId, text, platforms, scheduledTime, mediaUrls }) => {
    const body: Record<string, unknown> = { accountId, text, platforms };
    if (scheduledTime) body.scheduledTime = scheduledTime;
    if (mediaUrls) body.mediaUrls = mediaUrls;
    const data = await api.request({ path: "/grpc/v1/social-drafts/create", body });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("social_list_drafts", "List pending social drafts.", {
    accountId: z.string(), pageSize: z.number().optional(), cursor: z.string().optional(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/social-drafts/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ── 7. AI Knowledge ──────────────────────────────────────────────────────

  server.tool("ai_knowledge_list", "List knowledge entries for AI Employees.", {
    accountId: z.string(), pageSize: z.number().optional(), cursor: z.string().optional(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/knowledge/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("ai_knowledge_create", "Add a knowledge entry.", {
    accountId: z.string(), title: z.string(), content: z.string(), category: z.string().optional(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/knowledge/create", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("ai_knowledge_update", "Update a knowledge entry.", {
    knowledgeId: z.string(), accountId: z.string(), title: z.string().optional(),
    content: z.string().optional(), category: z.string().optional(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/knowledge/update", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  server.tool("ai_knowledge_delete", "Delete a knowledge entry.", {
    knowledgeId: z.string(), accountId: z.string(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/knowledge/delete", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ── 8. Vanalytics ────────────────────────────────────────────────────────

  server.tool("vanalytics_search_transcripts", "Search call/conversation transcripts.", {
    accountId: z.string(), query: z.string().optional(),
    startDate: z.string().optional(), endDate: z.string().optional(),
    pageSize: z.number().optional(), cursor: z.string().optional(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/vanalytics/transcripts/search", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ── 9. Customer Voice ─────────────────────────────────────────────────────

  server.tool("customer_voice_send_request", "Send an SMS or email review request.", {
    accountId: z.string(), recipientName: z.string(), recipientEmail: z.string().optional(),
    recipientPhone: z.string().optional(), channel: z.enum(["sms", "email"]),
    templateId: z.string().optional(),
  }, async (params) => {
    const data = await api.request({ path: "/grpc/v1/customer-voice/request/send", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  // ── 10. Raw ──────────────────────────────────────────────────────────────

  server.tool("vendasta_raw", "Raw authenticated request to any Vendasta endpoint.", {
    method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
    path: z.string(), body: z.record(z.unknown()).optional(), query: z.record(z.string()).optional(),
  }, async ({ method, path, body, query }) => {
    const data = await api.request({ method, path, body, query });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  });

  return server;
}

// ── HTTP server ──────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function handler(req: IncomingMessage, res: ServerResponse) {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", tools: 27 }));
    return;
  }

  // MCP endpoint
  if (req.method === "POST" && req.url === "/mcp") {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  // 404
  res.writeHead(404);
  res.end("Not found. POST /mcp for MCP, GET /health for status.");
}

const httpServer = createServer(handler);
httpServer.listen(PORT, () => {
  console.log(`Vendasta MCP server (HTTP) listening on :${PORT}`);
});
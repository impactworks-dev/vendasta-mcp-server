#!/usr/bin/env node
/**
 * vendasta-mcp-server
 *
 * A Model Context Protocol server that exposes Vendasta's API to any
 * MCP-compatible client (Claude Desktop, Cursor, VS Code, ClickUp, etc.).
 *
 * Covers: Accounts/Business, CRM, Reputation, Sales Orders,
 *         Conversations, Social, AI Knowledge.
 *
 * Auth: 2-legged OAuth2 JWT bearer assertion (service account key file).
 *
 * Env vars:
 *   VENDASTA_CREDENTIALS_PATH  — path to the service-account JSON key file
 *   VENDASTA_ENV               — "prod" (default) or "demo"
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { VendastaClient } from "./client.js";
import type { VendastaCredentials } from "./auth.js";

// ── Bootstrap ────────────────────────────────────────────────────────────────

const credsPath = process.env.VENDASTA_CREDENTIALS_PATH;
if (!credsPath) {
  console.error("Set VENDASTA_CREDENTIALS_PATH to your service-account key JSON.");
  process.exit(1);
}

const creds: VendastaCredentials = JSON.parse(readFileSync(credsPath, "utf-8"));
const env = (process.env.VENDASTA_ENV ?? "prod") as "prod" | "demo";
const api = new VendastaClient(creds, env);

const server = new McpServer({
  name: "vendasta",
  version: "1.0.0",
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  1. ACCOUNTS / BUSINESS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "list_accounts",
  "List business accounts (locations) in your Vendasta partner. Supports cursor pagination.",
  {
    pageSize: z.number().min(1).max(100).optional().describe("Results per page (default 25)"),
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
    searchTerm: z.string().optional().describe("Filter accounts by company name or keyword"),
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

server.tool(
  "get_account",
  "Get detailed info about a single business account by its Account Group ID (AG-xxx).",
  {
    accountId: z.string().describe("Account Group ID, e.g. AG-ABC123"),
  },
  async ({ accountId }) => {
    const data = await api.request({
      path: "/grpc/v1/business/get",
      body: { accountId },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "create_account",
  "Create a new business account (location) in Vendasta.",
  {
    companyName: z.string().describe("Business/company name"),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional().describe("ISO 2-letter country code"),
    phone: z.string().optional(),
    website: z.string().optional(),
    contactFirstName: z.string().optional(),
    contactLastName: z.string().optional(),
    contactEmail: z.string().optional(),
  },
  async (params) => {
    const data = await api.request({
      path: "/grpc/v1/business/create",
      body: params,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "update_account",
  "Update fields on an existing business account.",
  {
    accountId: z.string().describe("Account Group ID"),
    companyName: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
    phone: z.string().optional(),
    website: z.string().optional(),
    contactFirstName: z.string().optional(),
    contactLastName: z.string().optional(),
    contactEmail: z.string().optional(),
  },
  async ({ accountId, ...fields }) => {
    const data = await api.request({
      path: "/grpc/v1/business/update",
      body: { accountId, ...fields },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  2. CRM — Contacts, Companies, Activities
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "crm_list_field_schemas",
  "List CRM field schemas for a namespace. Useful to discover available fields before querying.",
  {
    namespace: z.string().describe("Partner ID (P-xxx) or Account Group ID (AG-xxx)"),
    crmObjectType: z.enum(["Contact", "Company", "Activity", "CustomObject"]).optional(),
    pageSize: z.number().optional(),
    cursor: z.string().optional(),
  },
  async (params) => {
    const data = await api.request({ path: "/grpc/v1/crm/field-schema/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "crm_list_records",
  "List CRM records (contacts, companies, activities, custom objects) with optional filters.",
  {
    namespace: z.string().describe("Partner ID or Account Group ID"),
    resourceType: z.enum(["contacts", "companies", "activities", "customobjects"]),
    filters: z.array(z.object({
      id: z.string().describe("Field ID, e.g. standard__email"),
      value: z.unknown().describe("Filter value"),
      operation: z.string().optional().describe("Filter op, e.g. equals, contains"),
    })).optional().describe("Field-level filters"),
    returnFields: z.array(z.string()).optional().describe("Fields to include in response"),
    pageSize: z.number().optional(),
    cursor: z.string().optional(),
  },
  async ({ namespace, resourceType, filters, returnFields, pageSize, cursor }) => {
    const body: Record<string, unknown> = {};
    if (filters) body.fields = filters;
    if (returnFields) body.returnFields = returnFields;
    if (pageSize) body.pageSize = pageSize;
    if (cursor) body.cursor = cursor;

    const data = await api.request({
      path: `/org/list/${namespace}/${resourceType}`,
      body,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "crm_upsert_record",
  "Create or update a CRM record (contact, company, activity, custom object). Uses PATCH semantics.",
  {
    namespace: z.string().describe("Partner ID or Account Group ID"),
    resourceType: z.enum(["contacts", "companies", "activities", "customobjects"]),
    fields: z.array(z.object({
      id: z.string().describe("Field ID"),
      value: z.unknown(),
      operation: z.string().optional().describe("Merge strategy: always_overwrite, set_if_empty, etc."),
    })),
    searchExisting: z.array(z.object({
      id: z.string(),
      value: z.unknown(),
    })).optional().describe("Fields to match for dedup; if found, updates existing record"),
    associations: z.array(z.object({
      id: z.string(),
      type: z.string(),
      subtype: z.string().optional(),
    })).optional(),
  },
  async ({ namespace, resourceType, fields, searchExisting, associations }) => {
    const body: Record<string, unknown> = { fields };
    if (searchExisting) body.searchExisting = searchExisting;
    if (associations) {
      body.contact_associations = associations.filter(a => a.type === "Contact");
      body.company_associations = associations.filter(a => a.type === "Company");
      body.activity_associations = associations.filter(a => a.type === "Activity");
    }

    const data = await api.request({
      method: "PATCH",
      path: `/org/${namespace}/${resourceType}`,
      body,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "crm_delete_record",
  "Delete a CRM record by ID.",
  {
    namespace: z.string(),
    resourceType: z.enum(["contacts", "companies", "activities", "customobjects"]),
    recordId: z.string().describe("The record ID to delete"),
  },
  async ({ namespace, resourceType, recordId }) => {
    const data = await api.request({
      method: "DELETE",
      path: `/org/${namespace}/${resourceType}/${recordId}`,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  3. REPUTATION — Reviews
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "reputation_list_reviews",
  "List reviews for a business account, optionally filtered by source or rating.",
  {
    accountId: z.string().describe("Account Group ID"),
    pageSize: z.number().optional(),
    cursor: z.string().optional(),
    minRating: z.number().min(1).max(5).optional(),
    maxRating: z.number().min(1).max(5).optional(),
    source: z.string().optional().describe("Review source, e.g. google, facebook"),
  },
  async ({ accountId, pageSize, cursor, minRating, maxRating, source }) => {
    const body: Record<string, unknown> = { accountId };
    if (pageSize) body.pageSize = pageSize;
    if (cursor) body.cursor = cursor;
    if (minRating) body.minRating = minRating;
    if (maxRating) body.maxRating = maxRating;
    if (source) body.source = source;

    const data = await api.request({ path: "/grpc/v1/reputation/reviews/list", body });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "reputation_get_summary",
  "Get reputation summary (avg rating, total reviews, breakdown by source) for an account.",
  {
    accountId: z.string().describe("Account Group ID"),
  },
  async ({ accountId }) => {
    const data = await api.request({
      path: "/grpc/v1/reputation/summary/get",
      body: { accountId },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "reputation_reply_to_review",
  "Post a reply to a review (supported sources only, e.g. Google).",
  {
    accountId: z.string(),
    reviewId: z.string(),
    replyText: z.string(),
  },
  async ({ accountId, reviewId, replyText }) => {
    const data = await api.request({
      path: "/grpc/v1/reputation/reviews/reply",
      body: { accountId, reviewId, replyText },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  4. SALES ORDERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "sales_list_orders",
  "List sales orders, optionally filtered by account or status.",
  {
    accountId: z.string().optional(),
    status: z.string().optional().describe("Order status filter"),
    pageSize: z.number().optional(),
    cursor: z.string().optional(),
  },
  async (params) => {
    const data = await api.request({ path: "/grpc/v1/sales-orders/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "sales_get_order",
  "Get details of a specific sales order.",
  {
    orderId: z.string(),
  },
  async ({ orderId }) => {
    const data = await api.request({
      path: "/grpc/v1/sales-orders/get",
      body: { orderId },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "sales_create_order",
  "Create a new sales order for an account.",
  {
    accountId: z.string(),
    lineItems: z.array(z.object({
      productId: z.string(),
      quantity: z.number().optional(),
      customPrice: z.number().optional(),
    })),
  },
  async ({ accountId, lineItems }) => {
    const data = await api.request({
      path: "/grpc/v1/sales-orders/create",
      body: { accountId, lineItems },
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  5. CONVERSATIONS / AI MESSAGING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "conversation_list",
  "List conversations for a business account.",
  {
    accountId: z.string(),
    pageSize: z.number().optional(),
    cursor: z.string().optional(),
    channel: z.string().optional().describe("Filter by channel: sms, webchat, email, etc."),
  },
  async (params) => {
    const data = await api.request({ path: "/grpc/v1/conversation/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "conversation_get_messages",
  "Get messages in a specific conversation thread.",
  {
    conversationId: z.string(),
    pageSize: z.number().optional(),
    cursor: z.string().optional(),
  },
  async (params) => {
    const data = await api.request({ path: "/grpc/v1/conversation/messages/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "conversation_send_message",
  "Send a message in a conversation thread (e.g. SMS reply, webchat response).",
  {
    conversationId: z.string(),
    message: z.string(),
    channel: z.string().optional().describe("sms, webchat, email"),
  },
  async (params) => {
    const data = await api.request({ path: "/grpc/v1/conversation/messages/send", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  6. SOCIAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "social_list_posts",
  "List social media posts for an account, with optional date range.",
  {
    accountId: z.string(),
    pageSize: z.number().optional(),
    cursor: z.string().optional(),
    startDate: z.string().optional().describe("ISO 8601 start date"),
    endDate: z.string().optional().describe("ISO 8601 end date"),
  },
  async (params) => {
    const data = await api.request({ path: "/grpc/v1/social-posts/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "social_create_draft",
  "Create a social media draft post for review before publishing.",
  {
    accountId: z.string(),
    text: z.string().describe("Post content"),
    platforms: z.array(z.string()).describe("Target platforms: facebook, instagram, google, linkedin, etc."),
    scheduledTime: z.string().optional().describe("ISO 8601 datetime to schedule publishing"),
    mediaUrls: z.array(z.string()).optional().describe("URLs of images/videos to attach"),
  },
  async ({ accountId, text, platforms, scheduledTime, mediaUrls }) => {
    const body: Record<string, unknown> = { accountId, text, platforms };
    if (scheduledTime) body.scheduledTime = scheduledTime;
    if (mediaUrls) body.mediaUrls = mediaUrls;

    const data = await api.request({ path: "/grpc/v1/social-drafts/create", body });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "social_list_drafts",
  "List pending social media drafts for an account.",
  {
    accountId: z.string(),
    pageSize: z.number().optional(),
    cursor: z.string().optional(),
  },
  async (params) => {
    const data = await api.request({ path: "/grpc/v1/social-drafts/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  7. AI KNOWLEDGE (for Vendasta AI Employees / Chatbots)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "ai_knowledge_list",
  "List knowledge entries available to AI Employees for a given account.",
  {
    accountId: z.string(),
    pageSize: z.number().optional(),
    cursor: z.string().optional(),
  },
  async (params) => {
    const data = await api.request({ path: "/grpc/v1/knowledge/list", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "ai_knowledge_create",
  "Add a knowledge entry for AI Employees on a given account.",
  {
    accountId: z.string(),
    title: z.string(),
    content: z.string().describe("Markdown or plain-text knowledge content"),
    category: z.string().optional(),
  },
  async (params) => {
    const data = await api.request({ path: "/grpc/v1/knowledge/create", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "ai_knowledge_update",
  "Update an existing knowledge entry.",
  {
    knowledgeId: z.string(),
    accountId: z.string(),
    title: z.string().optional(),
    content: z.string().optional(),
    category: z.string().optional(),
  },
  async (params) => {
    const data = await api.request({ path: "/grpc/v1/knowledge/update", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "ai_knowledge_delete",
  "Delete a knowledge entry.",
  {
    knowledgeId: z.string(),
    accountId: z.string(),
  },
  async (params) => {
    const data = await api.request({ path: "/grpc/v1/knowledge/delete", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  8. VANALYTICS — Call & Conversation Analytics
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "vanalytics_search_transcripts",
  "Search call and conversation transcripts via Vanalytics.",
  {
    accountId: z.string(),
    query: z.string().optional().describe("Keyword search across transcripts"),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    pageSize: z.number().optional(),
    cursor: z.string().optional(),
  },
  async (params) => {
    const data = await api.request({ path: "/grpc/v1/vanalytics/transcripts/search", body: params });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  9. CUSTOMER VOICE — Review Requests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "customer_voice_send_request",
  "Send an SMS or email review request to a customer via Customer Voice.",
  {
    accountId: z.string(),
    recipientName: z.string(),
    recipientEmail: z.string().optional(),
    recipientPhone: z.string().optional(),
    channel: z.enum(["sms", "email"]),
    templateId: z.string().optional(),
  },
  async (params) => {
    const data = await api.request({
      path: "/grpc/v1/customer-voice/request/send",
      body: params,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  10. UTILITY — Raw API call
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "vendasta_raw",
  "Make a raw authenticated request to any Vendasta API endpoint. Escape hatch for endpoints not covered by other tools.",
  {
    method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
    path: z.string().describe("API path, e.g. /grpc/v1/crm/field-schema/list"),
    body: z.record(z.unknown()).optional().describe("JSON request body"),
    query: z.record(z.string()).optional().describe("Query string params (for GET requests)"),
  },
  async ({ method, path, body, query }) => {
    const data = await api.request({ method, path, body, query });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Start
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Vendasta MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
# Vendasta MCP Server

A custom [Model Context Protocol](https://modelcontextprotocol.io) server that exposes **Vendasta's API** to any MCP-compatible client: Claude Desktop, Cursor, VS Code, ClickUp Super Agents, and more.

> **Note:** Vendasta's official MCP is on their H2 2026 roadmap. This server fills the gap right now.

## What it covers

| Domain | Tools | What you can do |
|--------|-------|------------------|
| **Accounts/Business** | 4 | List, get, create, update business locations |
| **CRM** | 4 | List schemas, list/upsert/delete contacts, companies, activities, custom objects |
| **Reputation** | 3 | List reviews, get summary, reply to reviews |
| **Sales Orders** | 3 | List, get, create orders |
| **Conversations** | 3 | List conversations, get messages, send messages |
| **Social** | 3 | List posts, create/list drafts |
| **AI Knowledge** | 4 | CRUD knowledge entries for AI Employees |
| **Vanalytics** | 1 | Search call/conversation transcripts |
| **Customer Voice** | 1 | Send SMS/email review requests |
| **Raw** | 1 | Escape hatch for any Vendasta endpoint |
| **Total** | **27 tools** | |

## Prerequisites

1. **Node.js 20+**
2. A **Vendasta service account** with a downloaded key file (JSON with `private_key`, `client_email`, `kid`, `token_uri`)
   - Create one in Partner Center > Settings > Service Accounts
   - Download the RSA key pair JSON

## Setup

```bash
# Clone / copy the server files
cd vendasta-mcp-server

# Install dependencies
npm install

# Build
npm run build
```

## Configuration

Create a `.env` file (or set these environment variables):

```bash
# Required: path to your Vendasta service-account key file
VENDASTA_CREDENTIALS_PATH=/path/to/client-credentials.json

# Optional: "prod" (default) or "demo"
VENDASTA_ENV=prod
```

## Usage

### Claude Desktop / Claude Code

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vendasta": {
      "command": "node",
      "args": ["/absolute/path/to/vendasta-mcp-server/dist/index.js"],
      "env": {
        "VENDASTA_CREDENTIALS_PATH": "/path/to/client-credentials.json",
        "VENDASTA_ENV": "prod"
      }
    }
  }
}
```

### Cursor / VS Code

Add to `.cursor/mcp.json` or VS Code MCP settings:

```json
{
  "mcpServers": {
    "vendasta": {
      "command": "node",
      "args": ["./vendasta-mcp-server/dist/index.js"],
      "env": {
        "VENDASTA_CREDENTIALS_PATH": "./client-credentials.json"
      }
    }
  }
}
```

### ClickUp (Custom MCP Server)

To connect this to ClickUp's Super Agents, host it as a **remote MCP server** with Streamable HTTP transport:

1. **Deploy to a public URL** (Replit, Railway, Fly.io, your own VPS)
2. Add the HTTP transport wrapper (see "Remote deployment" below)
3. In ClickUp App Center > MCP Servers > Add Custom Server > enter your URL

### npm / npx (after publishing)

```bash
npx vendasta-mcp-server
```

## Remote deployment (Streamable HTTP)

For ClickUp or any remote MCP client, wrap the server with HTTP transport:

```typescript
// src/remote.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

// ... (same server setup as index.ts) ...

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

app.listen(3000, () => console.log("Vendasta MCP remote server on :3000"));
```

## Tool reference

### Accounts
- `list_accounts` -- Search and paginate business locations
- `get_account` -- Get one account by AG-xxx ID
- `create_account` -- Create a new business location
- `update_account` -- Update account fields

### CRM
- `crm_list_field_schemas` -- Discover available fields for any namespace
- `crm_list_records` -- List contacts, companies, activities with filters
- `crm_upsert_record` -- Create or update a record (dedup with searchExisting)
- `crm_delete_record` -- Delete a record by ID

### Reputation
- `reputation_list_reviews` -- List reviews with rating/source filters
- `reputation_get_summary` -- Avg rating, total count, by-source breakdown
- `reputation_reply_to_review` -- Post a reply (Google, etc.)

### Sales Orders
- `sales_list_orders` -- List orders, filter by account/status
- `sales_get_order` -- Get order details
- `sales_create_order` -- Create a new order with line items

### Conversations
- `conversation_list` -- List conversations (SMS, webchat, email)
- `conversation_get_messages` -- Get messages in a thread
- `conversation_send_message` -- Send a reply

### Social
- `social_list_posts` -- List published social posts
- `social_create_draft` -- Create a draft for review/scheduling
- `social_list_drafts` -- List pending drafts

### AI Knowledge
- `ai_knowledge_list` -- List knowledge entries for AI Employees
- `ai_knowledge_create` -- Add knowledge content
- `ai_knowledge_update` -- Edit existing knowledge
- `ai_knowledge_delete` -- Remove knowledge

### Analytics & Voice
- `vanalytics_search_transcripts` -- Search call/conversation transcripts
- `customer_voice_send_request` -- Send SMS/email review request

### Utility
- `vendasta_raw` -- Raw authenticated request to any Vendasta endpoint

## Auth details

Uses Vendasta's **2-legged OAuth2** flow:
1. Reads your service-account key file (RSA private key)
2. Signs an RS256 JWT assertion (aud: `https://iam-prod.apigateway.co`)
3. Exchanges it at `https://sso-api-prod.apigateway.co/oauth2/token`
4. Caches the token until 30s before expiry
5. Attaches it as `Authorization: Bearer` on every API call

## Extending

Add new tools in `src/index.ts` using the same pattern:

```typescript
server.tool(
  "my_new_tool",
  "Description of what it does",
  { param: z.string() },
  async ({ param }) => {
    const data = await api.request({ path: "/grpc/v1/...", body: { param } });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);
```

## Multi-tenant usage

For multiple Vendasta partner accounts (e.g. `pwps` and `OBYD`), you can either:
- Run separate server instances with different credential files
- Modify the server to accept a `partnerId` param and switch credentials dynamically

## License

MIT
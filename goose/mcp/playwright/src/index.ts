#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { chromium } from "playwright";

const server = new Server({ name: "goose-mcp-playwright", version: "0.1.0" }, {
  capabilities: {},
});

const inputSchema = z.object({ url: z.string().url(), path: z.string() });

// tools/list handler
server.setRequestHandler(
  RequestSchema.extend({ method: z.literal("tools/list") }),
  async (_req) => {
    return {
      _meta: undefined,
      nextCursor: undefined,
      tools: [
        {
          name: "open_and_screenshot",
          description: "Open a URL and save a screenshot to a PNG path",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string" },
              path: { type: "string" },
            },
          } as any,
        },
      ],
    } as any;
  }
);

// tools/call handler
server.setRequestHandler(
  RequestSchema.extend({
    method: z.literal("tools/call"),
    params: z
      .object({
        name: z.string(),
        arguments: inputSchema.optional(),
      })
      .passthrough()
      .optional(),
  }),
  async (req) => {
    const { name } = req.params ?? { name: "" };
    if (name !== "open_and_screenshot") {
      return { _meta: undefined, content: [{ type: "text", text: `Unknown tool: ${name}` }] } as any;
    }
    const args = (req.params?.arguments ?? {}) as z.infer<typeof inputSchema>;
    const { url, path } = inputSchema.parse(args);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await (await browser.newContext()).newPage();
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await page.screenshot({ path });
      return { _meta: undefined, content: [{ type: "text", text: `Saved screenshot to ${path}` }] } as any;
    } finally {
      await browser.close();
    }
  }
);

const transport = new StdioServerTransport();
server.connect(transport).catch((err: unknown) => {
  console.error("MCP server failed:", err);
  process.exit(1);
});

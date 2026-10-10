import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "vitest";
import { createGuards } from "agentic-core";
import { createMcpServer } from "./mcp.js";

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content[0].text;
}

async function linked() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  return { clientTransport, serverTransport };
}

describe("mcp server", () => {
  test("serves three tools over a client link", async () => {
    const { clientTransport, serverTransport } = await linked();
    const server = createMcpServer();
    await server.connect(serverTransport);
    const client = new Client({ name: "probe", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      expect(names).toEqual(["generate_image", "get_cost_report", "list_vendors"]);

      const preview = await client.callTool({
        name: "generate_image",
        arguments: { prompt: "a cat" },
      });
      expect(JSON.parse(textOf(preview))).toMatchObject({ dryRun: true, vendor: "flux" });

      const vendors = await client.callTool({ name: "list_vendors", arguments: {} });
      expect(JSON.parse(textOf(vendors))).toHaveLength(4);

      const report = await client.callTool({ name: "get_cost_report", arguments: {} });
      expect(JSON.parse(textOf(report))).toHaveProperty("dispatches");
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("a blocked prompt returns a tool error, not a crash", async () => {
    const { clientTransport, serverTransport } = await linked();
    const server = createMcpServer({ guards: createGuards({ blocklist: ["nope"] }) });
    await server.connect(serverTransport);
    const client = new Client({ name: "probe", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: "generate_image",
        arguments: { prompt: "nope" },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(textOf(result)).toContain("blocklisted");
    } finally {
      await client.close();
      await server.close();
    }
  });

  test("an unknown vendor returns a tool error, not a crash", async () => {
    const { clientTransport, serverTransport } = await linked();
    const server = createMcpServer();
    await server.connect(serverTransport);
    const client = new Client({ name: "probe", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: "generate_image",
        arguments: { prompt: "x", vendor: "other" },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(textOf(result)).toContain("unknown vendor");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

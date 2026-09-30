#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadProjectContext, RulesValidationError } from "./config.js";
import { createServer } from "./server.js";

function parseRootArg(argv: string[]): string | undefined {
  const i = argv.indexOf("--root");
  if (i !== -1) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith("--root="));
  return eq?.slice("--root=".length);
}

async function main(): Promise<void> {
  const rootArg = parseRootArg(process.argv.slice(2));

  let ctx;
  try {
    ctx = loadProjectContext(rootArg);
  } catch (error) {
    if (error instanceof RulesValidationError) {
      console.error(`kritikka-mcp: ${error.message}`);
      for (const issue of error.issues) console.error(`  - ${issue}`);
      console.error("Fix mcp-rules.json and restart the server.");
    } else {
      console.error(`kritikka-mcp: failed to start: ${(error as Error).message}`);
    }
    process.exit(1);
  }

  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());
  // Keep the process alive; stdio transport handles shutdown on stream close.
  await new Promise(() => {});
}

main().catch((error) => {
  console.error(`kritikka-mcp: fatal: ${(error as Error).message}`);
  process.exit(1);
});

#!/usr/bin/env node
import { loginCommand, logoutCommand, statusCommand, getCredentialsPath } from "./login.js";

const args = process.argv.slice(2);
const command = args[0];

function printUsage(): void {
  console.log(`
Griphook - MCP server for STRATO

Usage: griphook <command>

Commands:
  login     Authenticate with BlockApps via browser
  logout    Clear stored credentials
  status    Show current authentication status
  serve     Start the MCP server (default)
  help      Show this help message

Authentication:
  Griphook supports three authentication modes:

  1. Browser login (recommended):
     $ griphook login
     Opens browser for OAuth authentication, stores refresh token locally.

  2. Password mode (legacy):
     Set environment variables:
       BLOCKAPPS_USERNAME, BLOCKAPPS_PASSWORD,
       OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET,
       OPENID_DISCOVERY_URL

  3. Token mode:
     Set STRATO_ACCESS_TOKEN with a pre-obtained access token.

Credentials are stored in: ${getCredentialsPath()}

For MCP server configuration, see the documentation.
`);
}

async function main(): Promise<void> {
  switch (command) {
    case "login":
      await loginCommand();
      break;

    case "logout":
      logoutCommand();
      break;

    case "status":
      statusCommand();
      break;

    case "serve":
    case undefined:
      // Start MCP server - dynamic import to avoid loading everything for CLI commands
      const { start } = await import("./server.js");
      await start();
      break;

    case "help":
    case "--help":
    case "-h":
      printUsage();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

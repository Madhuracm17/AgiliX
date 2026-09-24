import { readFileSync } from 'fs';
import * as path from 'path';

/** Reads the version from agilix-backend/package.json (works from src/mcp and dist/mcp). */
function readBackendVersion(): string {
  try {
    const packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Identity reported to MCP clients during the initialize handshake. */
export const AGILIX_MCP_SERVER_INFO = {
  name: 'agilix',
  version: readBackendVersion(),
} as const;

/**
 * Safety switch for tools that change data (create / update / delete).
 *
 * AgiliX has no authentication yet, and any local MCP client gets full access to
 * the services. While this is false, the server refuses to start if a registered
 * tool has `readOnly: false`. Changing it is a deliberate team decision made in
 * code, not an environment variable.
 */
export const MCP_WRITE_TOOLS_ENABLED = false;
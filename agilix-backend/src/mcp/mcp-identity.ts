import { UnauthorizedException } from '@nestjs/common';
import type { Connection } from 'mongoose';
import type { AuthUser } from '../auth/jwt-config';
import { UserRole } from '../users/schemas/user.schema';

/**
 * Who the MCP server acts as.
 *
 * MCP clients (Claude Desktop, MCP Inspector) start this process locally over
 * stdio, so there is no login screen and no JWT. Instead the server acts as one
 * real AgiliX account, chosen by MCP_USER_EMAIL in agilix-backend/.env.
 *
 * Every business tool then runs the SAME checks as the HTTP routes:
 * AccessService for project / sprint / task membership, and requireRole for
 * manager-only reports. So an MCP client set up as a developer sees exactly
 * what that developer sees in the web app, and nothing more.
 *
 * The account is looked up on every tool call (like the HTTP guard, which reads
 * the role from the database), so a role change applies straight away.
 */
export interface McpIdentity extends AuthUser {
  name: string;
  email: string;
}

const NOT_CONFIGURED =
  'The MCP server is not linked to an AgiliX account. Set MCP_USER_EMAIL in agilix-backend/.env ' +
  'to the email of the user it should act as, then restart the MCP server.';

/** The configured email, or null when MCP_USER_EMAIL is not set. */
export function configuredMcpEmail(): string | null {
  const email = process.env.MCP_USER_EMAIL?.trim().toLowerCase();
  return email ? email : null;
}

/**
 * Loads the MCP account. Throws 401 (reported to the client as
 * "Error 401: ...") when it is not configured or no longer exists.
 */
export async function loadMcpIdentity(connection: Connection): Promise<McpIdentity> {
  const email = configuredMcpEmail();
  if (!email) throw new UnauthorizedException(NOT_CONFIGURED);

  const user = (await connection
    .model('User')
    .findOne({ email })
    .select('name email role')
    .lean()
    .exec()) as { _id: unknown; name?: string; email?: string; role?: string } | null;

  if (!user) {
    throw new UnauthorizedException(
      `MCP_USER_EMAIL is set to "${email}", but no AgiliX account has that email.`,
    );
  }

  return {
    userId: String(user._id),
    role: (user.role as UserRole) ?? UserRole.DEVELOPER,
    name: user.name ?? '',
    email: user.email ?? email,
  };
}

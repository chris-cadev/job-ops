/**
 * `jobops tenants` commands — list tenants and their users.
 *
 * ponytail: single subcommand, reuses apiRequest pattern from other CLI commands.
 */

import { apiRequest } from "../lib/client.js";
import { printJson, printTable } from "../lib/output.js";

type TenantUser = { id: string; username: string; displayName: string | null };
type Tenant = { id: string; name: string; slug: string; users: TenantUser[] };
type TenantsResponse = { tenants: Tenant[] };

export async function cmdTenantsList(
  options: Record<string, string>,
): Promise<void> {
  const data = await apiRequest<TenantsResponse>("GET", "/tenants", undefined, {
    apiUrl: options["api-url"],
  });

  if (options.format === "table") {
    // Flatten tenant + user list into rows
    const rows: Record<string, unknown>[] = [];
    for (const tenant of data.tenants) {
      for (const user of tenant.users) {
        rows.push({
          tenant: tenant.name,
          tenantId: tenant.id,
          user: user.username,
          userId: user.id,
          displayName: user.displayName ?? "-",
        });
      }
    }
    printTable(rows);
  } else {
    printJson(data);
  }
}

export async function dispatchTenants(
  subcommand: string,
  _args: string[],
  options: Record<string, string>,
): Promise<void> {
  switch (subcommand) {
    case "list":
    case "":
      return cmdTenantsList(options);
    default:
      console.error(`Unknown tenants subcommand: "${subcommand}"`);
      console.error("Available: list");
      process.exit(1);
  }
}

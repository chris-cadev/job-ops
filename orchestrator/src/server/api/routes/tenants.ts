/**
 * Tenant & user listing endpoint for the CLI setup.
 *
 * GET /api/tenants — returns tenants with their user memberships.
 *   - System admins see all tenants.
 *   - Regular users see only their own tenant.
 *
 * ponytail: single route, minimal projection, no admin guard middleware.
 */

import { AppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { getTenantId, isSystemAdmin } from "@infra/request-context";
import { db, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { Router } from "express";

const { tenantMemberships, tenants, users } = schema;

type TenantUser = { id: string; username: string; displayName: string | null };
type TenantRow = {
  id: string;
  name: string;
  slug: string;
  users: TenantUser[];
};

export const tenantsRouter = Router();

tenantsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const admin = isSystemAdmin();
    const currentTenantId = getTenantId();

    // Query tenants with their user memberships in one pass, then group.
    const rows = await db
      .select({
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
      })
      .from(tenants)
      .innerJoin(tenantMemberships, eq(tenantMemberships.tenantId, tenants.id))
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .orderBy(tenants.name);

    // Group by tenant, filtering by access level.
    const tenantMap = new Map<string, TenantRow>();

    for (const row of rows) {
      if (!admin && row.tenantId !== currentTenantId) continue;

      let entry = tenantMap.get(row.tenantId);
      if (!entry) {
        entry = {
          id: row.tenantId,
          name: row.tenantName,
          slug: row.tenantSlug,
          users: [],
        };
        tenantMap.set(row.tenantId, entry);
      }
      entry.users.push({
        id: row.userId,
        username: row.username,
        displayName: row.displayName,
      });
    }

    const result = Array.from(tenantMap.values());
    ok(res, { tenants: result });
  } catch (error) {
    logger.error("Failed to list tenants", { error });
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
});

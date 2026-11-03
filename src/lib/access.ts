import { adminRequired, isAdmin, requireAdmin } from "./http.ts";
import { FEATURED_NS } from "./ledger.ts";

export interface Access {
  ns: string;
  canWrite: boolean;
  adminRequired: boolean;
}

/** Everyone reads the one shared ledger. */
export async function readAccess(req: Request): Promise<Access> {
  return { ns: FEATURED_NS, canWrite: isAdmin(req), adminRequired: adminRequired() };
}

/** Operator actions (questions, results, expert predictions) need the admin token. Players use /api/predict. */
export async function writeAccess(req: Request): Promise<Access> {
  requireAdmin(req);
  return { ns: FEATURED_NS, canWrite: true, adminRequired: adminRequired() };
}

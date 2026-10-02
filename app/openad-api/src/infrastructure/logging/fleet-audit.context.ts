import type { Request } from 'express';

/** Structured operator + request identity for fleet Pino logs (T040). */
export interface FleetAuditContext {
  correlationId: string;
  operatorUserId: string;
  operatorEmail: string;
  operatorRole: string;
}

type JwtUser = {
  userId: string;
  email: string;
  role: string;
};

/**
 * Reads correlation id from pino-http `req.id` or `x-correlation-id` header,
 * and JWT user from Passport (`req.user`).
 */
export function extractFleetAuditFromRequest(req: Request): FleetAuditContext {
  const u = req.user as JwtUser | undefined;
  const withId = req as Request & { id?: string };
  const header = req.headers['x-correlation-id'];
  const fromHeader =
    typeof header === 'string'
      ? header
      : Array.isArray(header)
        ? header[0]
        : undefined;

  const correlationId =
    (typeof withId.id === 'string' && withId.id) ||
    fromHeader ||
    'unknown';

  return {
    correlationId,
    operatorUserId: u?.userId ?? 'unknown',
    operatorEmail: u?.email ?? 'unknown',
    operatorRole: u?.role ?? 'unknown',
  };
}

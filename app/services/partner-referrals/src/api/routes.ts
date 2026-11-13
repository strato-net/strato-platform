import crypto from "crypto";
import express from "express";
import { config } from "../config";
import { query } from "../db/pool";
import { toAddress } from "../utils/num";

const UNIQUE_VIOLATION = "23505";

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const badRequest = (message: string) => new ApiError(400, "BAD_REQUEST", message);

const asyncHandler =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) =>
    fn(req, res).catch(next);

const bearer = (req: express.Request): string => {
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !token) throw new ApiError(401, "UNAUTHORIZED", "Missing bearer key");
  return token;
};

/** Compares a presented key with a configured one in constant time. */
const sameKey = (presented: string, key: string): boolean => {
  const [a, b] = [Buffer.from(presented), Buffer.from(key)];
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** The partner a request's key belongs to; each key reads only the codes issued through it. */
const partnerOf = (req: express.Request): string => {
  const token = bearer(req);
  for (const [key, partner] of config.apiKeys) {
    if (sameKey(token, key)) return partner;
  }
  throw new ApiError(401, "UNAUTHORIZED", "Unknown key");
};

/** Only the app backend, which holds the internal key, gets past this. */
const internalOnly = (req: express.Request): void => {
  if (!config.internalKey || !sameKey(bearer(req), config.internalKey)) throw new ApiError(401, "UNAUTHORIZED", "Unknown key");
};

/** An optional string field: absent and null are both "not shared". */
const optional = (body: any, field: string): string | null => {
  const v = body[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || !v.trim() || v.length > 320 || v.includes("\0")) throw badRequest(`${field} must be a non-empty string`);
  return v.trim();
};

const time = (v: unknown, what: string): Date => {
  const d = new Date(typeof v === "string" ? v : "");
  if (Number.isNaN(d.getTime())) throw badRequest(`${what} must be an ISO 8601 timestamp`);
  return d;
};

// No 0/O or 1/I/L, so a code survives being read aloud or retyped.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = (): string =>
  Array.from({ length: 10 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");

/** Issues a code to a user who has none; null when the user already has one. */
const drawCode = async (owner: (string | null)[]): Promise<string | null> => {
  for (let draw = 1; ; draw++) {
    try {
      const { rows } = await query<{ code: string }>(
        `INSERT INTO codes (code, partner, external_user_id, x_user_id, email, wallet) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (partner, external_user_id) DO NOTHING
         RETURNING code`,
        [newCode(), ...owner]
      );
      return rows[0]?.code ?? null;
    } catch (error: any) {
      // The drawn code is already another user's: draw again.
      if (error?.code !== UNIQUE_VIOLATION || draw === 5) throw error;
    }
  }
};

// Full paths on a strict, case-sensitive router: each endpoint has exactly
// one spelling, so a path rule in front of the service (nginx, a load
// balancer) cannot be sidestepped with another case or an extra slash.
export const router = express.Router({ caseSensitive: true, strict: true });
router.use(express.json());

router.get("/partner-api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Issue a user's referral code. One code per (partner, external_user_id):
// calling again returns the same code and takes in any identifier newly shared.
router.post(
  "/partner-api/referrals/codes",
  asyncHandler(async (req, res) => {
    const partner = partnerOf(req);
    const body = req.body ?? {};
    const externalUserId = optional(body, "external_user_id");
    if (!externalUserId) throw badRequest("external_user_id is required");
    const wallet = optional(body, "wallet");
    if (wallet && !toAddress(wallet)) throw badRequest("wallet must be a 20-byte hex address");
    const owner = [partner, externalUserId, optional(body, "x_user_id"), optional(body, "email")?.toLowerCase() ?? null, toAddress(wallet)];
    let code = await drawCode(owner);
    const created = code !== null;
    if (!code) {
      // The user has a code: any identifier newly shared is taken in, and
      // the row is only written when that changes it.
      const { rows } = await query<{ code: string }>(
        `WITH shared AS (
           UPDATE codes SET x_user_id = COALESCE($3, x_user_id), email = COALESCE($4, email), wallet = COALESCE($5, wallet)
           WHERE partner = $1 AND external_user_id = $2
             AND (COALESCE($3, x_user_id), COALESCE($4, email), COALESCE($5, wallet)) IS DISTINCT FROM (x_user_id, email, wallet)
         )
         SELECT code FROM codes WHERE partner = $1 AND external_user_id = $2`,
        owner
      );
      code = rows[0].code;
    }
    res.json({
      code,
      ...(config.refLinkBase ? { ref_link: `${config.refLinkBase}?ref=${code}` } : {}),
      created,
    });
  })
);

// Referrals, traders and volume per code of the calling key, for [from, to).
router.get(
  "/partner-api/referrals/metrics",
  asyncHandler(async (req, res) => {
    const partner = partnerOf(req);
    const from = time(req.query.from, "from");
    const to = time(req.query.to, "to");
    if (from >= to) throw badRequest("from must be before to");
    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw badRequest("limit must be an integer from 1 to 1000");
    const cursor = req.query.cursor === undefined ? "" : req.query.cursor;
    if (typeof cursor !== "string" || !/^[A-Z0-9]*$/.test(cursor)) throw badRequest("cursor must be a next_cursor of this endpoint");
    const [codes, progress] = await Promise.all([
      query<{ code: string; external_user_id: string; referrals: string; traders: string; volume_usd: string }>(
        `SELECT c.code, c.external_user_id,
                COUNT(DISTINCT r.account) FILTER (WHERE r.created_at >= $2 AND r.created_at < $3 AND s.active) AS referrals,
                COUNT(DISTINCT a.account) AS traders,
                ROUND(COALESCE(SUM(a.usd_wad), 0) / 1e18, 2)::text AS volume_usd
         FROM codes c
         LEFT JOIN referrals r ON r.code = c.code
         -- A wallet (counted_from set) is a referral once it has activity
         -- from then on; without that test, confirming would cost nothing.
         LEFT JOIN LATERAL (
           SELECT r.counted_from IS NULL
               OR EXISTS (SELECT 1 FROM activity x WHERE x.account = r.account AND x.block_ts >= r.counted_from) AS active
         ) s ON true
         LEFT JOIN activity a ON a.account = r.account AND a.block_ts >= $2 AND a.block_ts < $3
                             AND (r.counted_from IS NULL OR a.block_ts >= r.counted_from)
         WHERE c.partner = $1 AND c.code > $4
         GROUP BY c.code
         ORDER BY c.code
         LIMIT $5`,
        [partner, from, to, cursor, limit + 1]
      ),
      query<{ as_of: Date }>("SELECT as_of FROM progress WHERE name = 'cirrus'"),
    ]);
    const page = codes.rows.slice(0, limit);
    res.json({
      data_as_of: progress.rows[0]?.as_of.toISOString() ?? null,
      codes: page.map((r) => ({
        code: r.code,
        external_user_id: r.external_user_id,
        referrals: Number(r.referrals),
        traders: Number(r.traders),
        volume_usd: r.volume_usd,
      })),
      next_cursor: codes.rows.length > limit ? page[page.length - 1].code : null,
    });
  })
);

// Internal, called by the app backend when a new account signed up through
// a ref link, or when an external wallet confirmed one (then with since: the
// wallet's activity counts from that time). First code wins, and an owner's
// own account (by the wallet or email they shared) is not their referral.
// signed_up_at is when the account signed up, for a signup that arrives
// later (a retry, a replay); a time ahead of the clock is not taken.
router.post(
  "/partner-api/referrals/signups",
  asyncHandler(async (req, res) => {
    internalOnly(req);
    const body = req.body ?? {};
    const account = toAddress(body.account);
    const code = optional(body, "code");
    if (!account || !code) throw badRequest("code and account are required");
    const since = body.since === undefined || body.since === null ? null : time(body.since, "since");
    const signedUpAt = body.signed_up_at === undefined || body.signed_up_at === null ? null : time(body.signed_up_at, "signed_up_at");
    const { rowCount } = await query(
      `INSERT INTO referrals (account, code, counted_from, created_at)
       SELECT $1, code, $4::timestamptz, LEAST($5::timestamptz, now()) FROM codes
       WHERE code = $2 AND wallet IS DISTINCT FROM $1 AND ($3::text IS NULL OR email IS DISTINCT FROM $3)
       ON CONFLICT (account) DO NOTHING`,
      [account, code.toUpperCase(), optional(body, "email")?.toLowerCase() ?? null, since, signedUpAt]
    );
    res.json({ recorded: rowCount === 1 });
  })
);

// Internal: whether a signup of this account with this code would be
// recorded. The backend asks before it has a wallet sign anything.
router.get(
  "/partner-api/referrals/signups",
  asyncHandler(async (req, res) => {
    internalOnly(req);
    const account = toAddress(req.query.account);
    const code = optional(req.query, "code");
    if (!account || !code) throw badRequest("code and account are required");
    const { rows } = await query<{ claimable: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM codes WHERE code = $2 AND wallet IS DISTINCT FROM $1)
          AND NOT EXISTS (SELECT 1 FROM referrals WHERE account = $1) AS claimable`,
      [account, code.toUpperCase()]
    );
    res.json({ claimable: rows[0].claimable });
  })
);

router.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  // express.json() rejects a body it cannot take (malformed, too large) with a 4xx of its own
  const apiError = error instanceof ApiError ? error : error?.status < 500 ? badRequest("Malformed or oversized JSON body") : null;
  if (!apiError) return next(error);
  res.status(apiError.status).json({ error: { code: apiError.code, message: apiError.message } });
});

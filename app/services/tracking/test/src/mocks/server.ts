// Mock upstreams for the tracking service integration suite:
//   * OpenID discovery + JWKS (dashboard JWT verification) and a test-only
//     token minting endpoint, so tests never need real Keycloak credentials
//   * A Cirrus/PostgREST look-alike that serves rows seeded by the tests,
//     supporting the filter subset the tracking service actually uses
//     (eq/neq/in/gt/gte/lt/lte, attributes->>key, order, limit, offset,
//     select projection with alias:column::cast). Embedded resources
//     (storage!inner(...)) are ignored; storage.contract.contract_name is
//     matched against a plain `contract_name` field on the seeded row.
//
// Env: MOCKS_PORT (default 4100), MOCKS_PUBLIC_URL (URL the tracking
// container uses to reach this server; embedded in the discovery document).
import crypto from "crypto";
import http from "http";
import jwt from "jsonwebtoken";

const port = Number(process.env.MOCKS_PORT || 4100);
const publicUrl = (process.env.MOCKS_PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, "");

// ---------------------------------------------------------------------------
// OIDC / JWKS
// ---------------------------------------------------------------------------
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "tracking-test-key";
const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: KID, alg: "RS256", use: "sig" };
const privatePem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;

const mintToken = (username: string, expiresInSeconds = 3600): string =>
  jwt.sign(
    { preferred_username: username, email: username, iss: `${publicUrl}/realm` },
    privatePem,
    { algorithm: "RS256", keyid: KID, expiresIn: expiresInSeconds, subject: username }
  );

// ---------------------------------------------------------------------------
// Cirrus (PostgREST subset)
// ---------------------------------------------------------------------------
type Row = Record<string, any>;
const tables = new Map<string, Row[]>();

const RESERVED = new Set(["select", "order", "limit", "offset"]);

const columnValue = (row: Row, column: string): unknown => {
  const jsonMatch = column.match(/^([a-zA-Z0-9_]+)->>(.+)$/);
  if (jsonMatch) {
    const container = row[jsonMatch[1]];
    return container && typeof container === "object" ? container[jsonMatch[2]] : undefined;
  }
  if (column === "storage.contract.contract_name") return row.contract_name;
  return row[column];
};

const parseInList = (raw: string): string[] =>
  raw
    .replace(/^\(/, "")
    .replace(/\)$/, "")
    .split(",")
    .map((v) => v.trim().replace(/^"|"$/g, ""))
    .filter((v) => v.length > 0);

const matches = (row: Row, column: string, filter: string): boolean => {
  const dot = filter.indexOf(".");
  const op = dot === -1 ? "eq" : filter.slice(0, dot);
  const operand = dot === -1 ? filter : filter.slice(dot + 1);
  const value = columnValue(row, column);
  const asString = value == null ? null : String(value);
  switch (op) {
    case "eq":
      return asString === operand;
    case "neq":
      return asString !== operand;
    case "in":
      return asString != null && parseInList(operand).includes(asString);
    case "is":
      return operand === "null" ? value == null : String(value) === operand;
    case "like":
    case "ilike": {
      const re = new RegExp("^" + operand.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", op === "ilike" ? "i" : "");
      return asString != null && re.test(asString);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (value == null) return false;
      const a = Number.isFinite(Number(value)) && Number.isFinite(Number(operand)) ? Number(value) : String(value);
      const b = typeof a === "number" ? Number(operand) : operand;
      if (op === "gt") return a > b;
      if (op === "gte") return a >= b;
      if (op === "lt") return a < b;
      return a <= b;
    }
    default:
      return false;
  }
};

// Split on top-level commas only (embedded resources contain commas)
const splitSelect = (select: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of select) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
};

const project = (row: Row, select: string | null): Row => {
  if (!select || select === "*") return row;
  const out: Row = {};
  for (const item of splitSelect(select)) {
    if (item.includes("(")) continue; // embedded resource: not needed by the service
    // Grammar: [alias:]column[::cast] — strip the cast first so its "::"
    // does not confuse the alias separator
    const [withoutCast, cast] = item.split("::");
    const aliasSep = withoutCast.indexOf(":");
    const alias = aliasSep === -1 ? null : withoutCast.slice(0, aliasSep);
    const column = aliasSep === -1 ? withoutCast : withoutCast.slice(aliasSep + 1);
    let value = columnValue(row, column);
    if (cast === "text" && value != null && typeof value !== "object") value = String(value);
    out[alias ?? column] = value;
  }
  return out;
};

const queryTable = (table: string, params: URLSearchParams): Row[] => {
  let rows = [...(tables.get(table) ?? [])];
  for (const [key, filter] of params.entries()) {
    if (RESERVED.has(key)) continue;
    rows = rows.filter((row) => matches(row, key, filter));
  }
  const order = params.get("order");
  if (order) {
    const clauses = order.split(",").map((c) => {
      const [column, direction] = c.split(".");
      return { column, desc: direction === "desc" };
    });
    rows.sort((a, b) => {
      for (const { column, desc } of clauses) {
        const av = columnValue(a, column);
        const bv = columnValue(b, column);
        if (av === bv) continue;
        const cmp = av == null ? 1 : bv == null ? -1 : av < bv ? -1 : 1;
        return desc ? -cmp : cmp;
      }
      return 0;
    });
  }
  const offset = Number(params.get("offset") || 0);
  const limit = params.get("limit") ? Number(params.get("limit")) : rows.length;
  rows = rows.slice(offset, offset + limit);
  const select = params.get("select");
  return rows.map((row) => project(row, select));
};

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------
const readJson = (req: http.IncomingMessage): Promise<any> =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (!body) return resolve(null);
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });

const send = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", publicUrl);
  const path = url.pathname;
  try {
    if (path === "/health") return send(res, 200, { status: true });
    if (path === "/.well-known/openid-configuration") {
      return send(res, 200, {
        issuer: `${publicUrl}/realm`,
        jwks_uri: `${publicUrl}/jwks`,
        authorization_endpoint: `${publicUrl}/realm/auth`,
        token_endpoint: `${publicUrl}/realm/token`,
      });
    }
    if (path === "/jwks") return send(res, 200, { keys: [jwk] });
    if (path === "/__test/token" && req.method === "POST") {
      const body = (await readJson(req)) ?? {};
      if (typeof body.username !== "string" || !body.username) {
        return send(res, 400, { error: "username required" });
      }
      return send(res, 200, { token: mintToken(body.username, body.expiresInSeconds) });
    }
    if (path === "/__test/cirrus" && req.method === "DELETE") {
      tables.clear();
      return send(res, 200, { ok: true });
    }
    const seedMatch = path.match(/^\/__test\/cirrus\/(.+)$/);
    if (seedMatch) {
      const table = decodeURIComponent(seedMatch[1]);
      if (req.method === "POST" || req.method === "PUT") {
        const rows = await readJson(req);
        if (!Array.isArray(rows)) return send(res, 400, { error: "expected an array of rows" });
        const existing = req.method === "PUT" ? [] : tables.get(table) ?? [];
        tables.set(table, [...existing, ...rows]);
        return send(res, 200, { table, rows: tables.get(table)!.length });
      }
      if (req.method === "DELETE") {
        tables.delete(table);
        return send(res, 200, { ok: true });
      }
    }
    const cirrusMatch = path.match(/^\/cirrus\/search\/(.+)$/);
    if (cirrusMatch && req.method === "GET") {
      const table = decodeURIComponent(cirrusMatch[1]);
      return send(res, 200, queryTable(table, url.searchParams));
    }
    send(res, 404, { error: `no mock for ${req.method} ${path}` });
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, () => {
  console.log(`[mocks] listening on ${port} (public url ${publicUrl})`);
});

import crypto from "crypto";
import { query } from "../db/pool";
import { config } from "../config";

export interface TrackingLink {
  id: string;
  slug: string;
  label: string;
  source: string | null;
  created_by: string;
  destination: string;
  active: boolean;
  created_at: Date;
}

const SLUG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 8;
const UNIQUE_VIOLATION = "23505";

// Random base62 slug; carries no prospect/campaign information by design.
const generateSlug = (): string => {
  const bytes = crypto.randomBytes(SLUG_LENGTH);
  let slug = "";
  for (let i = 0; i < SLUG_LENGTH; i++) {
    slug += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return slug;
};

export const publicUrlForSlug = (slug: string): string =>
  `${config.tracking.appOrigin || ""}/t/${slug}`;

export const createLink = async (
  label: string,
  source: string | null,
  destination: string,
  createdBy: string
): Promise<TrackingLink> => {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await query<TrackingLink>(
        `INSERT INTO tracking_links (slug, label, source, created_by, destination)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [generateSlug(), label, source, createdBy, destination]
      );
      return result.rows[0];
    } catch (error: any) {
      if (error?.code !== UNIQUE_VIOLATION || attempt >= 4) throw error;
    }
  }
};

export const listLinks = async (): Promise<TrackingLink[]> => {
  const result = await query<TrackingLink>(
    "SELECT * FROM tracking_links ORDER BY created_at DESC"
  );
  return result.rows;
};

export const getLinkById = async (id: string): Promise<TrackingLink | null> => {
  if (!/^\d+$/.test(id)) return null;
  const result = await query<TrackingLink>("SELECT * FROM tracking_links WHERE id = $1", [id]);
  return result.rows[0] ?? null;
};

export const updateLink = async (
  id: string,
  fields: { active?: boolean; label?: string; source?: string }
): Promise<TrackingLink | null> => {
  const link = await getLinkById(id);
  if (!link) return null;
  const result = await query<TrackingLink>(
    `UPDATE tracking_links
     SET active = COALESCE($2, active),
         label = COALESCE($3, label),
         source = COALESCE($4, source)
     WHERE id = $1
     RETURNING *`,
    [id, fields.active ?? null, fields.label ?? null, fields.source ?? null]
  );
  return result.rows[0] ?? null;
};

interface CachedSlugEntry {
  link: Pick<TrackingLink, "id" | "destination" | "active"> | null;
  expiresAt: number;
}

const SLUG_CACHE_TTL_MS = 30_000;
const slugCache = new Map<string, CachedSlugEntry>();

// Resolver hot path: cached slug lookup so repeated opens skip the DB read.
export const getLinkBySlug = async (
  slug: string
): Promise<Pick<TrackingLink, "id" | "destination" | "active"> | null> => {
  const cached = slugCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.link;
  const result = await query<TrackingLink>(
    "SELECT id, destination, active FROM tracking_links WHERE slug = $1",
    [slug]
  );
  const link = result.rows[0] ?? null;
  slugCache.set(slug, { link, expiresAt: Date.now() + SLUG_CACHE_TTL_MS });
  return link;
};

import { Response } from "express";
import { AuthorizedRequest, resolveAuthorization } from "../auth/adminMiddleware";
import { config } from "../config";
import { createLink, publicUrlForSlug, updateLink } from "../services/linkService";
import { getLinkDetail, getLinkSummaries, invalidateSnapshot } from "../services/attributionService";
import { isAllowedDestination } from "../utils/destinations";

// GET /tracking-api/me — 200 always; "no access" is a state, not an error
export const me = async (req: AuthorizedRequest, res: Response): Promise<void> => {
  const { authorized } = await resolveAuthorization(req);
  res.json({ authorized });
};

// POST /tracking-api/links
export const create = async (req: AuthorizedRequest, res: Response): Promise<void> => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  const source = typeof req.body?.source === "string" ? req.body.source.trim() : "";
  const destination =
    typeof req.body?.destination === "string" && req.body.destination.trim() !== ""
      ? req.body.destination.trim()
      : config.tracking.defaultDestination;

  if (!label) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  if (label.length > 200 || source.length > 200) {
    res.status(400).json({ error: "label/source too long (max 200 chars)" });
    return;
  }
  if (!isAllowedDestination(destination)) {
    res.status(400).json({ error: "destination is not on the allowlist" });
    return;
  }

  const link = await createLink(label, source || null, destination, req.username ?? "unknown");
  invalidateSnapshot();
  res.status(201).json({ id: String(link.id), slug: link.slug, url: publicUrlForSlug(link.slug) });
};

// GET /tracking-api/links
export const list = async (_req: AuthorizedRequest, res: Response): Promise<void> => {
  res.json(await getLinkSummaries());
};

// GET /tracking-api/links/:id
export const detail = async (req: AuthorizedRequest, res: Response): Promise<void> => {
  const linkDetail = await getLinkDetail(req.params.id);
  if (!linkDetail) {
    res.status(404).json({ error: "Link not found" });
    return;
  }
  res.json(linkDetail);
};

// PATCH /tracking-api/links/:id — active toggle + label/source edits;
// slug and destination are immutable after creation
export const update = async (req: AuthorizedRequest, res: Response): Promise<void> => {
  const fields: { active?: boolean; label?: string; source?: string } = {};
  if (typeof req.body?.active === "boolean") fields.active = req.body.active;
  if (typeof req.body?.label === "string" && req.body.label.trim()) {
    fields.label = req.body.label.trim();
  }
  if (typeof req.body?.source === "string") fields.source = req.body.source.trim();
  if (Object.keys(fields).length === 0) {
    res.status(400).json({ error: "No editable fields provided" });
    return;
  }
  const link = await updateLink(req.params.id, fields);
  if (!link) {
    res.status(404).json({ error: "Link not found" });
    return;
  }
  invalidateSnapshot();
  res.json({ id: String(link.id), active: link.active });
};

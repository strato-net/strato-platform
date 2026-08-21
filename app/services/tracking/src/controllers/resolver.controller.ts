import crypto from "crypto";
import { Request, Response } from "express";
import { config } from "../config";
import { getLinkBySlug } from "../services/linkService";
import { recordSessionOpen, updateSessionGeo } from "../services/sessionService";
import { classifyClient } from "../utils/botDetector";
import { isValidDestination } from "../utils/destinations";
import {
  isExternalGeoConfigured,
  lookupGeoOffline,
  normalizeIp,
  resolveGeoExternal,
} from "../utils/geo";
import { logError } from "../utils/logger";

const buildCookie = (sessionId: string): string => {
  const parts = [
    `${config.tracking.cookieName}=${sessionId}`,
    "Path=/",
    `Max-Age=${config.tracking.cookieMaxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (config.ssl) parts.push("Secure");
  if (config.tracking.cookieDomain) parts.push(`Domain=${config.tracking.cookieDomain}`);
  return parts.join("; ");
};

// A cookie set by this host is invisible to a destination on ANOTHER host
// (and to any browser that drops third-party/partitioned cookies), so a
// cross-host redirect carries the session id in the URL as well: the app's
// beacons echo it back via ?stid= / X-Strato-Tid. Same-host destinations keep
// their URL untouched — the cookie already covers them.
const withSessionId = (destination: string, sessionId: string, req: Request): string => {
  if (destination.startsWith("/")) return destination;
  try {
    const url = new URL(destination);
    const host = typeof req.headers.host === "string" ? req.headers.host.toLowerCase() : "";
    if (url.host.toLowerCase() === host) return destination;
    url.searchParams.set("stid", sessionId);
    return url.toString();
  } catch {
    return destination;
  }
};

// Relative Location: the browser resolves it against the host the visitor
// actually requested, so every node edge that proxies /t/ gets its visitors
// redirected back to itself — no configured origin, no redirect_uri param.
const redirectTo = (res: Response, destination: string): void => {
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, destination);
};

// GET /t/:slug — must stay fast: session insert is fire-and-forget, and any
// failure still redirects the visitor into the app.
export const resolve = async (req: Request, res: Response): Promise<void> => {
  try {
    const link = await getLinkBySlug(req.params.slug ?? "");
    if (!link) {
      redirectTo(res, config.tracking.defaultDestination);
      return;
    }

    // Re-validate the stored destination (header-injection guard); inactive
    // links still record opens but land on the default page.
    const destination =
      link.active && isValidDestination(link.destination)
        ? link.destination
        : config.tracking.defaultDestination;

    const { bot, reason: botReason } = classifyClient(req);
    const sessionId = crypto.randomUUID();
    // req.ip honors X-Forwarded-For (trust proxy) — both nginx layers forward
    // it. Insert immediately with the offline estimate so the row exists
    // before the SPA's engage/wallet-connected beacons arrive; the live
    // lookup (when configured) overrides it asynchronously.
    const ip = req.ip;
    recordSessionOpen(
      sessionId,
      link.id,
      typeof req.headers.referer === "string" ? req.headers.referer.slice(0, 2048) : null,
      typeof req.headers["user-agent"] === "string"
        ? req.headers["user-agent"].slice(0, 1024)
        : null,
      bot,
      botReason,
      { ipAddress: normalizeIp(ip), ...lookupGeoOffline(ip) }
    );
    if (!bot && isExternalGeoConfigured()) {
      void resolveGeoExternal(ip)
        .then((geo) => (geo ? updateSessionGeo(sessionId, geo) : undefined))
        .catch((error) => logError("Resolver", error, { operation: "enrichSessionGeo" }));
    }

    if (!bot) {
      res.setHeader("Set-Cookie", buildCookie(sessionId));
    }
    redirectTo(res, bot ? destination : withSessionId(destination, sessionId, req));
  } catch (error) {
    logError("Resolver", error, { slug: req.params.slug });
    redirectTo(res, config.tracking.defaultDestination);
  }
};

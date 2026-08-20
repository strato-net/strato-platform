import { Request } from "express";

// Named crawlers, email scanners, link-preview fetchers and script clients.
// These are unambiguous: no matter how browser-like the rest of the UA looks
// (Googlebot's smartphone UA is a full Chrome string), the request is not a
// visitor.
const DEFINITE_BOT_RE = new RegExp(
  [
    "curl",
    "wget",
    "python-requests",
    "python-urllib",
    "go-http-client",
    "okhttp",
    "node-fetch",
    "axios/",
    "java/",
    "libwww",
    "headless",
    "phantomjs",
    "puppeteer",
    "playwright",
    "slackbot",
    "twitterbot",
    "facebookexternalhit",
    "facebookcatalog",
    "linkedinbot",
    "telegrambot",
    "discordbot",
    "skypeuripreview",
    "redditbot",
    "embedly",
    "quora link preview",
    "vkshare",
    "outbrain",
    "w3c_validator",
    "googlebot",
    "bingbot",
    "yandex",
    "baiduspider",
    "duckduckbot",
    "applebot",
    "ahrefsbot",
    "semrushbot",
    "mj12bot",
    "dotbot",
    "petalbot",
    "googleimageproxy",
    "ggpht",
    "yahoomailproxy",
    "barracuda",
    "mimecast",
    "proofpoint",
    "mailscanner",
    "symantec",
    "forcepoint",
    "trendmicro",
  ].join("|"),
  "i"
);

// Generic tokens that a real client can carry too: mobile in-app browsers
// (WhatsApp, Facebook/Instagram, Telegram, X) append their own product token
// to an otherwise ordinary Chrome/Safari UA, and device names contain "bot"
// (CUBOT phones). They only mean "bot" when nothing else in the UA looks like
// a rendering browser — see REAL_BROWSER_RE.
const AMBIGUOUS_BOT_RE = new RegExp(
  [
    "bot",
    "crawler",
    "crawling",
    "spider",
    "preview",
    "scan(ner)?",
    "monitor(ing)?",
    "validator",
    "fetcher",
    "whatsapp",
    "telegram",
    "pinterest",
  ].join("|"),
  "i"
);

// A rendering engine / browser product signature. Preview fetchers and script
// clients don't carry one; in-app browsers (which run our JS and can connect a
// wallet) always do.
const REAL_BROWSER_RE =
  /(applewebkit\/\d|gecko\/\d|chrome\/\d|crios\/\d|firefox\/\d|fxios\/\d|edg[ae]?\/\d|opr\/\d|samsungbrowser\/\d|trident\/\d|version\/[\d.]+ (mobile\/\S+ )?safari)/i;

export interface BotClassification {
  bot: boolean;
  // Short token persisted on the session row so a "why is this zero?" report
  // can be answered from the DB (null for an ordinary browser open).
  reason: string | null;
}

const reasonToken = (matched: string): string => matched.toLowerCase().slice(0, 40);

// Classification is best-effort: the engaged_at tier (set only by real JS in
// the SPA) is the authoritative human signal. When in doubt we now count the
// visitor — a missed bot only inflates opens, while a misfiled human loses the
// session cookie and with it every wallet/bridge attribution.
export const classifyClient = (req: Request): BotClassification => {
  if (req.method === "HEAD") return { bot: true, reason: "head-request" };
  const purpose = req.headers["purpose"] || req.headers["sec-purpose"];
  if (typeof purpose === "string" && purpose.includes("prefetch")) {
    return { bot: true, reason: "prefetch" };
  }
  const ua = req.headers["user-agent"];
  if (!ua) return { bot: true, reason: "no-user-agent" };

  const definite = DEFINITE_BOT_RE.exec(ua);
  if (definite) return { bot: true, reason: `bot-ua:${reasonToken(definite[0])}` };

  const ambiguous = AMBIGUOUS_BOT_RE.exec(ua);
  if (ambiguous) {
    if (REAL_BROWSER_RE.test(ua)) {
      // In-app browser / real client that merely mentions an ambiguous token
      return { bot: false, reason: `browser-ua:${reasonToken(ambiguous[0])}` };
    }
    return { bot: true, reason: `ambiguous-ua:${reasonToken(ambiguous[0])}` };
  }

  return { bot: false, reason: null };
};

import { Request } from "express";

// Email scanners, social link-preview fetchers, crawlers, and script clients.
// Classification is best-effort: the engaged_at tier (set only by real JS in
// the SPA) is the authoritative human signal.
const BOT_UA_RE = new RegExp(
  [
    "bot",
    "crawler",
    "spider",
    "crawling",
    "preview",
    "scan(ner)?",
    "monitor(ing)?",
    "validator",
    "fetcher",
    "curl",
    "wget",
    "python-requests",
    "python-urllib",
    "go-http-client",
    "okhttp",
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
    "whatsapp",
    "telegrambot",
    "discordbot",
    "skypeuripreview",
    "pinterest",
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

export const isBotOrPreview = (req: Request): boolean => {
  if (req.method === "HEAD") return true;
  const purpose = req.headers["purpose"] || req.headers["sec-purpose"];
  if (typeof purpose === "string" && purpose.includes("prefetch")) return true;
  const ua = req.headers["user-agent"];
  if (!ua) return true;
  return BOT_UA_RE.test(ua);
};

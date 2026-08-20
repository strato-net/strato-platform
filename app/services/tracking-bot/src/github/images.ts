import { log } from "../log";

// Issues about UI work usually carry mockups. Extract image URLs from
// markdown / HTML in the issue body and comments and download them so the
// models can look at them (base64 in the prompt).

export interface ImageAttachment {
  url: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  base64: string;
  bytes: number;
}

const MAX_IMAGES = 6;
const MAX_BYTES = 5 * 1024 * 1024;

const URL_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|<img[^>]+src=["'](https?:\/\/[^"']+)["']|(https?:\/\/github\.com\/user-attachments\/assets\/[A-Za-z0-9-]+)|(https?:\/\/user-images\.githubusercontent\.com\/[^\s)"'<>]+)/g;

export const extractImageUrls = (texts: string[]): string[] => {
  const urls: string[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(URL_RE)) {
      const url = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (url && !urls.includes(url)) urls.push(url);
    }
  }
  return urls;
};

const mediaTypeOf = (contentType: string | null, url: string): ImageAttachment["mediaType"] | null => {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (ct === "image/png" || ct === "image/jpeg" || ct === "image/gif" || ct === "image/webp") return ct;
  if (ct === "image/jpg") return "image/jpeg";
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return null;
};

export const fetchImages = async (urls: string[], token?: string): Promise<ImageAttachment[]> => {
  const out: ImageAttachment[] = [];
  for (const url of urls.slice(0, MAX_IMAGES)) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: token ? { Authorization: `Bearer ${token}`, Accept: "image/*" } : { Accept: "image/*" },
      });
      if (!res.ok) {
        log.warn("Images", `skip ${url}: HTTP ${res.status}`);
        continue;
      }
      const mediaType = mediaTypeOf(res.headers.get("content-type"), url);
      if (!mediaType) {
        log.warn("Images", `skip ${url}: not an image (${res.headers.get("content-type")})`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > MAX_BYTES) {
        log.warn("Images", `skip ${url}: ${buffer.length} bytes > limit`);
        continue;
      }
      out.push({ url, mediaType, base64: buffer.toString("base64"), bytes: buffer.length });
    } catch (error) {
      log.warn("Images", `skip ${url}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return out;
};

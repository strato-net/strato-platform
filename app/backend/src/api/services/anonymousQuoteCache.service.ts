import { ANONYMOUS_QUOTE_CACHE_SIZE, ANONYMOUS_QUOTE_TTL_MS } from "../../config/constants";
import { AnonymousQuoteCacheEntry } from "../../types/types";

const quotes = new Map<string, AnonymousQuoteCacheEntry>();

export const quoteCacheKey = (name: string, values: unknown[]): string => name + ":" + JSON.stringify(values.map(value => {
  if (value == null) return null;
  const text = String(value).trim();
  if (/^(0x)?[a-f0-9]{40}$/i.test(text)) return text.toLowerCase().replace(/^0x/, "");
  return /^\d+$/.test(text) ? BigInt(text).toString() : text;
}));

export const cachedAnonymousQuote = async <T>(key: string, userAddress: string | undefined, load: () => Promise<T>): Promise<T> => {
  if (userAddress) return load();
  const now = Date.now();
  for (const [key, entry] of quotes) if (entry.expiresAt <= now) quotes.delete(key);
  const cached = quotes.get(key);
  if (cached) return structuredClone(await cached.result) as T;
  if (quotes.size >= ANONYMOUS_QUOTE_CACHE_SIZE) return load();
  const entry = { expiresAt: now + ANONYMOUS_QUOTE_TTL_MS, result: Promise.resolve().then(load) };
  quotes.set(key, entry);
  try { return structuredClone(await entry.result); }
  catch (error) {
    if (quotes.get(key) === entry) quotes.delete(key);
    throw error;
  }
};

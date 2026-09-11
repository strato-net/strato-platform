import { ANONYMOUS_QUOTE_CACHE_SIZE, ANONYMOUS_QUOTE_TTL_MS } from "../../config/constants";
import { AnonymousQuoteCacheEntry } from "../../types/types";

const quotes = new Map<string, AnonymousQuoteCacheEntry>();

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

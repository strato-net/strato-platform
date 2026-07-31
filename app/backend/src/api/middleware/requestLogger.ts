import { Request, Response, NextFunction } from "express";

interface RouteStats {
  count: number;
  totalMs: number;
  min: number;
  max: number;
}

const stats = new Map<string, RouteStats>();

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = performance.now();
  res.on("finish", () => {
    if (!req.route) return;

    const ms = performance.now() - start;
    const key = `${req.method} ${req.baseUrl}${req.route.path} ${res.statusCode}`;

    const entry = stats.get(key) ?? { count: 0, totalMs: 0, min: Infinity, max: 0 };
    entry.count++;
    entry.totalMs += ms;
    entry.min = Math.min(entry.min, ms);
    entry.max = Math.max(entry.max, ms);
    stats.set(key, entry);

    // console.log(
    //   JSON.stringify({
    //     method: req.method,
    //     path: req.originalUrl,
    //     status: res.statusCode,
    //     durationMs: ms.toFixed(2),
    //   })
    // );
  });
  next();
};

export const getRequestStats = (sortBy: "avg" | "max" | "count" = "avg") => {
  const entries = [...stats.entries()].map(([key, s]) => ({
    route: key,
    count: s.count,
    avgMs: +(s.totalMs / s.count).toFixed(2),
    minMs: +s.min.toFixed(2),
    maxMs: +s.max.toFixed(2),
  }));

  const sortKey = sortBy === "avg" ? "avgMs" : sortBy === "max" ? "maxMs" : "count";
  entries.sort((a, b) => b[sortKey] - a[sortKey]);

  return entries;
};

export const resetRequestStats = () => stats.clear();

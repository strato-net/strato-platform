import dotenv from "dotenv";
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  rwaIo: {
    apiKey: requireEnv("RWA_IO_API_KEY"),
    slug: "strato",
    baseUrl:
      process.env.RWA_IO_BASE_URL || "https://api.rwa.io",
  },
  strato: {
    tvlEndpoint:
      process.env.STRATO_TVL_ENDPOINT ||
      "https://app.strato.nexus/api/metrics/tvl",
  },
  /** Cron expression — default every hour at minute 0 */
  cronSchedule: process.env.CRON_SCHEDULE || "0 * * * *",
};

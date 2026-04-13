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
    baseUrl: "https://api.rwa.io",
  },
  strato: {
    tvlEndpoint: "https://app.strato.nexus/api/metrics/tvl",
  },
  /** Cron expression — every hour at minute 0 */
  cronSchedule: "0 * * * *",
};

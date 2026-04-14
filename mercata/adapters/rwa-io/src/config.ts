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
    baseUrl: "https://app.strato.nexus",
    tvlEndpoint: "https://app.strato.nexus/api/metrics/tvl",
  },
  tokens: [
    {
      address: "cdc93d30182125e05eec985b631c7c61b3f63ff0",
      symbol: "GOLDST",
      rwaIoAssetId: "69ad08f0a008b4e0b36d0620",
      timeSeries: {
        aum: "69ad08f0a008b4e0b36d0623",
        circulatingSupply: "69ad08f0a008b4e0b36d0625",
        marketCap: "69ad08f0a008b4e0b36d0624",
        nav: "69ad08f0a008b4e0b36d0622",
        price: "69ad08f0a008b4e0b36d0621",
        volume: "69ad08f0a008b4e0b36d0626",
      },
    },
    {
      address: "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94",
      symbol: "SILVST",
      rwaIoAssetId: "69ad09eca009b4e0b36d062a",
      timeSeries: {
        aum: "69ad09eda009b4e0b36d062d",
        circulatingSupply: "69ad09eda009b4e0b36d062f",
        marketCap: "69ad09eda009b4e0b36d062e",
        nav: "69ad09eda009b4e0b36d062c",
        price: "69ad09eda009b4e0b36d062b",
        volume: "69ad09eda009b4e0b36d0630",
      },
    },
  ],
  /** Cron expression — every hour at minute 0 */
  cronSchedule: "0 * * * *",
};

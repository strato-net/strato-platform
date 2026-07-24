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
    projectTimeSeries: {
      aum: "69c2f2b5367bd1e5bc20f0b6",
      marketCap: "69c2f2b5367bd1e5bc20f0b7",
      price: "69c2f2b5367bd1e5bc20f0b5",
      totalVolume: "69c2f2b5367bd1e5bc20f0b8",
      tvl: "69c2f2b5367bd1e5bc20f0b9",
      dailyTransactions: "69ea0bdbb63c79ac46d6f18b",
      uniqueWallets: "69ea0bdbb63c79ac46d6f18c",
    },
  },
  strato: {
    baseUrl: "https://app.strato.nexus",
    tvlEndpoint: "https://app.strato.nexus/api/metrics/tvl",
    /** Contract address of the STRATO token backing the project-level series. */
    projectTokenAddress: "2ca3e170e6714282da77815f7864b17f612f5f83",
  },
  tokens: [
    {
      address: "cdc93d30182125e05eec985b631c7c61b3f63ff0",
      symbol: "GOLDST",
      rwaIoAssetId: "69dd08f0a008b4e0b36d0620",
      timeSeries: {
        aum: "69dd08f1a008b4e0b36d0623",
        circulatingSupply: "69dd08f1a008b4e0b36d0625",
        marketCap: "69dd08f1a008b4e0b36d0624",
        nav: "69dd08f1a008b4e0b36d0622",
        price: "69dd08f1a008b4e0b36d0621",
        volume: "69dd08f1a008b4e0b36d0626",
      },
    },
    {
      address: "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94",
      symbol: "SILVST",
      rwaIoAssetId: "69dd09eca008b4e0b36d062a",
      timeSeries: {
        aum: "69dd09eda008b4e0b36d062d",
        circulatingSupply: "69dd09eda008b4e0b36d062f",
        marketCap: "69dd09eda008b4e0b36d062e",
        nav: "69dd09eda008b4e0b36d062c",
        price: "69dd09eda008b4e0b36d062b",
        volume: "69dd09eda008b4e0b36d0630",
      },
    },
    {
      address: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
      symbol: "USDST",
      rwaIoAssetId: "69ea0d3102db7539c0aa451c",
      timeSeries: {
        aum: "69ea0d3102db7539c0aa451f",
        circulatingSupply: "69ea0d3102db7539c0aa4521",
        marketCap: "69ea0d3102db7539c0aa4520",
        nav: "69ea0d3102db7539c0aa451e",
        price: "69ea0d3102db7539c0aa451d",
        volume: "69ea0d3102db7539c0aa4522",
      },
    },
  ],
  /** Cron expression — every hour at minute 0 */
  cronSchedule: "0 * * * *",
};

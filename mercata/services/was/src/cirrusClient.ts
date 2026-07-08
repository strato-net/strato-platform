import axios, { AxiosInstance } from "axios";
import { CirrusClient, CirrusQueryParams, WasConfig } from "./types";

export type AccessTokenProvider = () => Promise<string | undefined>;

const createHttpClient = (config: WasConfig): AxiosInstance =>
  axios.create({
    baseURL: `${config.nodeUrl}/cirrus/search`,
    timeout: 60_000,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
  });

export const createCirrusClient = (
  config: WasConfig,
  accessTokenProvider: AccessTokenProvider = async () => undefined,
): CirrusClient => {
  const http = createHttpClient(config);

  const getRows = async <T>(
    table: string,
    params: CirrusQueryParams = {},
  ): Promise<T[]> => {
    const accessToken = await accessTokenProvider();
    const response = await http.get<T[]>(table, {
      params,
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : undefined,
    });

    return Array.isArray(response.data) ? response.data : [];
  };

  return {
    getRows,
    verifyConnectivity: async () => {
      await getRows("/event", { limit: 1, select: "event_name" });
    },
  };
};

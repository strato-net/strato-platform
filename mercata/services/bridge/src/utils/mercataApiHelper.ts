import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { getBAUserToken } from '../auth';

const NODE_URL = process.env.NODE_URL;

const createApiClient = (baseURL: string): AxiosInstance => {
  const client = axios.create({
    baseURL,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    timeout: 60_000,
  });

  return {
    ...client,
    get: async <T = any>(url: string, config?: AxiosRequestConfig): Promise<T> => {
      const accessToken = await getBAUserToken();
      if (!accessToken) throw new Error('No access token available');
      
      const response = await client.get<T>(url, {
        ...config,
        headers: {
          ...(config?.headers || {}),
          Authorization: `Bearer ${accessToken}`,
        },
      });
      
      return response.data;
    },

    post: async <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> => {
      const accessToken = await getBAUserToken();
      if (!accessToken) throw new Error('No access token available');
      
      const response = await client.post<T>(url, data, {
        ...config,
        headers: {
          ...(config?.headers || {}),
          Authorization: `Bearer ${accessToken}`,
        },
      });
      
      return response.data;
    }
  } as AxiosInstance;
};

// Cirrus for reading/searching data
export const cirrus = createApiClient(`${NODE_URL}/cirrus/search`);

// Strato for posting transactions and contract interactions
export const strato = createApiClient(`${NODE_URL}/strato/v2.3`);

// Bloc for additional blockchain operations
export const bloc = createApiClient(`${NODE_URL}/bloc/v2.2`);

// ETH for Ethereum-specific operations
export const eth = createApiClient(`${NODE_URL}/strato-api/eth/v1.2`);

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { nodeUrl } from "../config/config";

const createApiClient = (baseURL: string): AxiosInstance =>
  axios.create({
    baseURL,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    timeout: 60_000,
  });

const _strato = createApiClient(`${nodeUrl}/strato/v2.3`);
const _cirrus = createApiClient(`${nodeUrl}/cirrus/search`);
const _bloc = createApiClient(`${nodeUrl}/bloc/v2.2`);
const _eth = createApiClient(`${nodeUrl}//strato-api/eth/v1.2`);

function makeTokenClient(client: AxiosInstance) {
  return {
    get: async <T = any>(
      token: string,
      url: string,
      config?: AxiosRequestConfig
    ): Promise<AxiosResponse<T>> => {
      return client.get<T>(url, {
        ...config,
        headers: {
          ...(config?.headers || {}),
          Authorization: `Bearer ${token}`,
        },
      });
    },

    post: async <T = any>(
      token: string,
      url: string,
      data?: any,
      config?: AxiosRequestConfig
    ): Promise<AxiosResponse<T>> => {
      return client.post<T>(url, data, {
        ...config,
        headers: {
          ...(config?.headers || {}),
          Authorization: `Bearer ${token}`,
        },
      });
    },
  };
}

export const strato = makeTokenClient(_strato);
export const cirrus = makeTokenClient(_cirrus);
export const bloc = makeTokenClient(_bloc);
export const eth = makeTokenClient(_eth);

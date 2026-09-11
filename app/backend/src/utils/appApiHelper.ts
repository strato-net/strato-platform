import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { nodeUrl, bridgeUrl } from "../config/config";
import { requestContext } from "./requestContext";
import { traceparentHeader } from "./tracing";

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
const _eth = createApiClient(`${nodeUrl}/strato-api/eth/v1.2`);

function unsignedTxInterceptor(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  // Calls to the node carry the request's trace, so strato-api's span nests
  // under this service's in one trace.
  const traceparent = traceparentHeader();
  if (traceparent) config.headers.set("traceparent", traceparent);
  const store = requestContext.getStore();
  if (store?.externalSigning && config.url?.includes("/transaction/parallel")) {
    config.baseURL = `${nodeUrl}/bloc/v2.2`;
    config.url = "/transaction/unsigned";
    if (config.data && typeof config.data === "object") {
      config.data = { ...config.data, address: store.userAddress };
    }
  }
  return config;
}

_strato.interceptors.request.use(unsignedTxInterceptor);
_bloc.interceptors.request.use(unsignedTxInterceptor);
// Reads carry the trace too (the interceptor only rewrites signing calls).
_cirrus.interceptors.request.use(unsignedTxInterceptor);
_eth.interceptors.request.use(unsignedTxInterceptor);

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

// Bridge client needs to be initialized after bridgeUrl is set
let bridgeClient: ReturnType<typeof makeTokenClient> | null = null;
const getBridgeClient = () => {
  if (!bridgeClient) {
    if (!bridgeUrl) throw new Error("Bridge URL not initialized.");
    bridgeClient = makeTokenClient(createApiClient(`${bridgeUrl}`));
  }
  return bridgeClient;
};
export const bridge = new Proxy({} as ReturnType<typeof makeTokenClient>, {
  get(_target, prop) {
    return getBridgeClient()[prop as keyof ReturnType<typeof makeTokenClient>];
  },
});

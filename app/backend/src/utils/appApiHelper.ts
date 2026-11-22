import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { nodeUrl, bridgeUrl } from "../config/config";
import { requestContext } from "./requestContext";
import { sharedLoadContext } from "./sharedPromise";
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

// A node call that fails inside a shared load marks it (see sharedPromise.ts), also when
// its caller catches the error. A 4xx answer other than 429 is the node's answer, not a
// failure: it would be the same next time.
function sharedLoadFailureInterceptor(error: any) {
  const status = error?.response?.status;
  if (!status || status >= 500 || status === 429) {
    const load = sharedLoadContext.getStore();
    if (load) load.failedCall ??= `${error?.config?.url} ${status ?? error?.code}`;
  }
  return Promise.reject(error);
}

_strato.interceptors.response.use(undefined, sharedLoadFailureInterceptor);
_cirrus.interceptors.response.use(undefined, sharedLoadFailureInterceptor);
_bloc.interceptors.response.use(undefined, sharedLoadFailureInterceptor);
_eth.interceptors.response.use(undefined, sharedLoadFailureInterceptor);

// An empty token is an anonymous call: no Authorization header at all (the
// node's nginx rejects a present-but-empty bearer token).
function authHeaders(token: string, config?: AxiosRequestConfig) {
  return {
    ...(config?.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function makeTokenClient(client: AxiosInstance) {
  return {
    get: async <T = any>(
      token: string,
      url: string,
      config?: AxiosRequestConfig
    ): Promise<AxiosResponse<T>> => {
      return client.get<T>(url, {
        ...config,
        headers: authHeaders(token, config),
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
        headers: authHeaders(token, config),
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

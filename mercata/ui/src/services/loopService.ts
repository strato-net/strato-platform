import { api } from "@/lib/axios";
import type {
  LoopBootstrapRequest,
  LoopBootstrapResponse,
  LoopExecuteResponse,
  LoopHistoryItem,
  LoopPositionResponse,
  LoopRouteType,
  LoopUnwindRequest,
} from "@/interface/loop";

const LOOP_BASE_PATH = "/loop";

export const loopService = {
  async bootstrap(payload: LoopBootstrapRequest): Promise<LoopBootstrapResponse> {
    const response = await api.post(`${LOOP_BASE_PATH}/bootstrap`, payload);
    return response.data;
  },

  async execute(payload: LoopBootstrapRequest): Promise<LoopExecuteResponse> {
    const response = await api.post(`${LOOP_BASE_PATH}/execute`, payload);
    return response.data;
  },

  async position(routeType: LoopRouteType, asset: string): Promise<LoopPositionResponse> {
    const response = await api.get(`${LOOP_BASE_PATH}/position`, {
      params: {
        routeType,
        asset,
      },
    });
    return response.data;
  },

  async unwind(payload: LoopUnwindRequest): Promise<LoopExecuteResponse> {
    const response = await api.post(`${LOOP_BASE_PATH}/unwind`, payload);
    return response.data;
  },

  async history(routeType: LoopRouteType, asset: string): Promise<LoopHistoryItem[]> {
    const response = await api.get(`${LOOP_BASE_PATH}/history`, {
      params: {
        routeType,
        asset,
      },
    });
    return Array.isArray(response.data) ? response.data : [];
  },
};

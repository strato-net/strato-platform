import { api } from "@/lib/axios";
import type {
  LoopBootstrapResponse,
  LoopExecuteRequest,
  LoopExecuteResponse,
  LoopHistoryItem,
  LoopPositionResponse,
  LoopUnwindRequest,
} from "@/interface/loop";

const LOOP_BASE_PATH = "/loop";

export const loopService = {
  async bootstrap(): Promise<LoopBootstrapResponse> {
    const response = await api.get(`${LOOP_BASE_PATH}/bootstrap`);
    return response.data;
  },

  async execute(payload: LoopExecuteRequest): Promise<LoopExecuteResponse> {
    const response = await api.post(`${LOOP_BASE_PATH}/execute`, payload);
    return response.data;
  },

  async position(): Promise<LoopPositionResponse> {
    const response = await api.get(`${LOOP_BASE_PATH}/position`);
    return response.data;
  },

  async unwind(payload: LoopUnwindRequest): Promise<LoopExecuteResponse> {
    const response = await api.post(`${LOOP_BASE_PATH}/unwind`, payload);
    return response.data;
  },

  async history(): Promise<LoopHistoryItem[]> {
    const response = await api.get(`${LOOP_BASE_PATH}/history`);
    return Array.isArray(response.data) ? response.data : [];
  },
};

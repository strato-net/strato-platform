import { api } from "@/lib/axios";
import type {
  LoopBootstrapResponse,
  LoopExecuteRequest,
  LoopExecuteResponse,
  LoopPositionResponse,
} from "@mercata/shared-types";

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
};

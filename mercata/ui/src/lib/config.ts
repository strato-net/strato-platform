import { api } from "./axios";

export interface ConfigData {
  projectId: string;
  networkId?: string;
  creditCardTopUpAddress?: string;
}

export const getConfig = async (): Promise<ConfigData> => {
  const response = await api.get("/config");
  return response.data.data;
}; 

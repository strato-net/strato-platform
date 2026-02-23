import { api } from "./axios";

export interface ConfigData {
  projectId: string;
  stripePublishableKey: string | null;
}

export const getConfig = async (): Promise<ConfigData> => {
  const response = await api.get("/config");
  return response.data.data;
};

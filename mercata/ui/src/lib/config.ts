import { api } from "./axios";

export interface ConfigData {
  projectId: string;
  networkId?: string;
  creditCardTopUpAddress?: string;
  featuredEarnOpportunity?: string;
  stripePublishableKey: string | null;
  contactEnabled?: boolean;
}

export const getConfig = async (): Promise<ConfigData> => {
  const response = await api.get("/config");
  return response.data.data;
};

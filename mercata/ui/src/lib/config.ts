import { api } from "./axios";
import { ConfigData } from "@mercata/shared-types";

export const getConfig = async (): Promise<ConfigData> => {
  const response = await api.get("/config");
  return response.data.data;
};

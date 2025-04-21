import axios from "axios";
import { nodeUrl } from "../config/config";

const createApiClient = (baseURL: string, token: string) =>
  axios.create({
    baseURL,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    timeout: 60000,
  });

export const getNetworkApiClient = (token: string) =>
  createApiClient(`${nodeUrl}/strato/v2.3`, token);

export const getDbApiClient = (token: string) =>
  createApiClient(`${nodeUrl}/cirrus/search`, token);
import axios from "axios";
import {
  WithdrawalAuditListResponse,
  WithdrawalAuditRouteType,
  WithdrawalAuditStatusGroup,
  WithdrawalAuditTrace,
} from "@mercata/shared-types";
import { wasUrl } from "../../config/config";

const wasClient = axios.create({
  baseURL: wasUrl,
  timeout: 60_000,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

export const getRecentWithdrawalAudits = async (
  limit = 10,
  maxDepth: number | undefined = undefined,
  statusGroup: WithdrawalAuditStatusGroup = "other"
): Promise<WithdrawalAuditListResponse> => {
  const response = await wasClient.get<WithdrawalAuditListResponse>(
    "/audits/withdrawals/recent",
    {
      params: {
        limit,
        maxDepth,
        statusGroup,
      },
    }
  );
  return response.data;
};

export const getWithdrawalAudit = async (
  routeType: WithdrawalAuditRouteType,
  withdrawalId: string,
  maxDepth: number | undefined = undefined
): Promise<WithdrawalAuditTrace | null> => {
  try {
    const response = await wasClient.get<WithdrawalAuditTrace>(
      `/audits/withdrawals/${routeType}/${withdrawalId}`,
      {
        params: {
          maxDepth,
        },
      }
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    throw error;
  }
};

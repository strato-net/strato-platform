import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";

const { mercataBridge } = constants;
const MERCATA_URL = "BlockApps-MercataBridge";

interface QueryFilters {
  status?: string;
  chainId?: string;
  limit?: string;
  offset?: string;
}

interface QueryConfig {
  select: string;
  address: string;
  order: string;
  keyField?: string;
  statusField: string;
  chainField: string;
}

const buildQueryParams = (filters: QueryFilters | undefined, config: QueryConfig) => {
  const { limit, offset, status, chainId } = filters || {};
  return {
    select: config.select,
    address: config.address,
    order: config.order,
    ...(status && { [config.statusField]: `eq.${status}` }),
    ...(chainId && { [config.chainField]: `eq.${chainId}` }),
    ...(limit && { limit }),
    ...(offset && { offset }),
  };
};

const buildCountParams = (filters: QueryFilters | undefined, config: QueryConfig) => {
  const { status, chainId } = filters || {};
  return {
    select: "count()",
    address: config.address,
    ...(status && { [config.statusField]: `eq.${status}` }),
    ...(chainId && { [config.chainField]: `eq.${chainId}` }),
  };
};

const fetchWithPagination = async (
  accessToken: string,
  endpoint: string,
  filters: QueryFilters | undefined,
  config: QueryConfig
) => {
  const [dataResponse, countResponse] = await Promise.all([
    cirrus.get(accessToken, endpoint, { params: buildQueryParams(filters, config) }),
    cirrus.get(accessToken, endpoint, { params: buildCountParams(filters, config) }),
  ]);

  return {
    data: dataResponse.data || [],
    totalCount: countResponse.data?.[0]?.count || 0,
  };
};

export const getAllWithdrawals = async (accessToken: string, filters?: QueryFilters) => {
  const config: QueryConfig = {
    select: "withdrawalId:key,WithdrawalInfo:value,block_timestamp",
    address: `eq.${mercataBridge}`,
    order: "block_timestamp.desc",
    statusField: "value->>bridgeStatus",
    chainField: "value->>externalChainId",
  };
  // Always filter by bridgeStatus = "2" (Pending Review) at Cirrus API level
  const filtersWithStatus = { ...filters, status: "2" };
  return fetchWithPagination(accessToken, `/${MERCATA_URL}-withdrawals`, filtersWithStatus, config);
};

export const getAllDeposits = async (accessToken: string, filters?: QueryFilters) => {
  const config: QueryConfig = {
    select: "externalChainId:key,externalTxHash:key2,DepositInfo:value,block_timestamp",
    address: `eq.${mercataBridge}`,
    order: "block_timestamp.desc",
    statusField: "value->>bridgeStatus",
    chainField: "key",
  };
  // Always filter by bridgeStatus = "2" (Pending Review) at Cirrus API level
  const filtersWithStatus = { ...filters, status: "2" };
  return fetchWithPagination(accessToken, `/${MERCATA_URL}-deposits`, filtersWithStatus, config);
};

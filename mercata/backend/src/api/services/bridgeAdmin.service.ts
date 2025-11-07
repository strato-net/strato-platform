import { cirrus, strato } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths } from "../../config/constants";
import { extractContractName } from "../../utils/utils";

const { MercataBridge, mercataBridge } = constants;
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
    order: "key.asc",
    statusField: "value->>bridgeStatus",
    chainField: "value->>externalChainId",
  };
  return fetchWithPagination(accessToken, `/${MERCATA_URL}-withdrawals`, filters, config);
};

export const getAllDeposits = async (accessToken: string, filters?: QueryFilters) => {
  const config: QueryConfig = {
    select: "externalChainId:key,externalTxHash:key2,DepositInfo:value,block_timestamp",
    address: `eq.${mercataBridge}`,
    order: "block_timestamp.asc",
    statusField: "value->>bridgeStatus",
    chainField: "key",
  };
  return fetchWithPagination(accessToken, `/${MERCATA_URL}-deposits`, filters, config);
};

export const getWithdrawalById = async (accessToken: string, withdrawalId: string) => {
  const { data } = await cirrus.get(accessToken, `/${MERCATA_URL}-withdrawals`, {
    params: {
      select: "withdrawalId:key,WithdrawalInfo:value,block_timestamp",
      key: `eq.${withdrawalId}`,
      address: `eq.${mercataBridge}`,
    },
  });
  return data?.[0] || null;
};

const executeAbort = async (
  accessToken: string,
  userAddress: string,
  method: string,
  args: Record<string, any>
) => {
  const tx = await buildFunctionTx(
    {
      contractName: extractContractName(MercataBridge),
      contractAddress: mercataBridge,
      method,
      args,
    },
    userAddress,
    accessToken
  );
  return postAndWaitForTx(accessToken, () => strato.post(accessToken, StratoPaths.transactionParallel, tx));
};

export const abortWithdrawal = async (accessToken: string, userAddress: string, withdrawalId: string) =>
  executeAbort(accessToken, userAddress, "abortWithdrawal", { id: withdrawalId });

export const abortDeposit = async (
  accessToken: string,
  userAddress: string,
  externalChainId: string,
  externalTxHash: string
) => executeAbort(accessToken, userAddress, "abortDeposit", { externalChainId, externalTxHash });

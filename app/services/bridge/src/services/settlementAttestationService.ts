import axios from "axios";
import {
  getExternalBridgeVerifierApiTokens,
  getExternalBridgeVerifierUrls,
} from "../config";
import { ActionDepositArgs, DepositArgs } from "../types";
import { logError, logInfo } from "../utils/logger";
import { WithdrawalAuthorization } from "./externalWithdrawalService";
import { getSettlementVerifierConfig } from "./cirrusService";

const signerHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
});

export class SettlementVerifierManualReviewRequired extends Error {}

const requestAllVerifiers = async (
  chainId: string | number,
  path: string,
  payload: unknown,
): Promise<void> => {
  const urls = getExternalBridgeVerifierUrls(BigInt(chainId));
  const apiTokens = getExternalBridgeVerifierApiTokens(BigInt(chainId));
  const { threshold } = await getSettlementVerifierConfig();
  if (urls.length === 0) {
    throw new Error(
      `No external bridge settlement verifiers configured for chain ${chainId}`,
    );
  }
  if (threshold < 2 || threshold > urls.length) {
    throw new Error(
      `Invalid settlement verifier threshold ${threshold} for ${urls.length} verifier services`,
    );
  }
  if (apiTokens.length !== urls.length) {
    throw new Error(
      `External bridge signer API token count does not match signer URL count for chain ${chainId}`,
    );
  }
  const results = await Promise.allSettled(
    urls.map((url, index) =>
      axios.post(`${url}${path}`, payload, {
        headers: signerHeaders(apiTokens[index]),
      }),
    ),
  );
  const succeeded = results.filter(
    (result) =>
      result.status === "fulfilled" &&
      typeof result.value.data?.transactionHash === "string" &&
      result.value.data.transactionHash.length > 0,
  ).length;
  const manualReviewRequired = results.filter(
    (result) =>
      result.status === "rejected" &&
      axios.isAxiosError(result.reason) &&
      result.reason.response?.status === 409 &&
      result.reason.response?.data?.decision === "manual_review",
  ).length;
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logError("SettlementAttestation", result.reason as Error, {
        chainId,
        verifierUrl: urls[index],
        path,
      });
    }
  });
  if (succeeded < threshold) {
    if (manualReviewRequired > 0) {
      throw new SettlementVerifierManualReviewRequired(
        `Settlement verifier manual review required for ${path}: ${manualReviewRequired}/${urls.length}`,
      );
    }
    throw new Error(
      `Settlement verifier threshold not reached for ${path}: ${succeeded}/${threshold}`,
    );
  }
  logInfo(
    "SettlementAttestation",
    `${succeeded}/${urls.length} settlement verifiers accepted ${path}`,
  );
};

export const attestDepositSettlement = async (
  deposit: DepositArgs | ActionDepositArgs,
): Promise<void> => {
  const actionDeposit = deposit as Partial<ActionDepositArgs>;
  await requestAllVerifiers(
    deposit.externalChainId,
    "/v1/attest-deposit",
    {
      externalChainId: String(deposit.externalChainId),
      depositRouter: deposit.depositRouter,
      depositId: String(deposit.depositId),
      externalSender: deposit.externalSender,
      externalToken: deposit.externalToken,
      externalTokenAmount: deposit.externalTokenAmount,
      externalTxHash: deposit.externalTxHash,
      externalBlockHash: deposit.externalBlockHash,
      externalLogIndex: deposit.externalLogIndex,
      stratoRecipient: deposit.stratoRecipient,
      stratoToken: deposit.targetStratoToken,
      action: actionDeposit.action || "0",
      actionToken:
        actionDeposit.actionToken ||
        "0000000000000000000000000000000000000000",
      minFinalOut: actionDeposit.minFinalOut || "0",
    },
  );
};

export const attestWithdrawalRelease = async (
  authorization: WithdrawalAuthorization,
  reservationId: string,
  externalTxHash: string,
): Promise<void> =>
  requestAllVerifiers(
    authorization.destinationChainId,
    "/v1/attest-release",
    { authorization, reservationId, externalTxHash },
  );

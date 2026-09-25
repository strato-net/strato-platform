import axios from "axios";
import {
  VERIFIER_REQUEST_TIMEOUT_MS,
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

const requestVerifierQuorum = async (
  chainId: string | number,
  path: string,
  payload: unknown,
): Promise<boolean> => {
  const urls = getExternalBridgeVerifierUrls(BigInt(chainId));
  const apiTokens = getExternalBridgeVerifierApiTokens(BigInt(chainId));
  const { threshold, verifiers } = await getSettlementVerifierConfig();
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
  const eligible = new Set(verifiers.map((address) => address.toLowerCase().replace(/^0x/, "")));
  if (eligible.size < threshold) throw new Error("Insufficient distinct settlement verifiers configured");
  const accepted = new Set<string>();
  const unrestricted = new Set<string>();
  const controller = new AbortController();
  let remaining = urls.length;
  let completed = false;
  let manualReviewRequired = 0;
  return new Promise<boolean>((resolve, reject) => {
    void Promise.allSettled(urls.map(async (url, index) => {
      try {
        const response = await axios.post(`${url}${path}`, payload, {
          timeout: VERIFIER_REQUEST_TIMEOUT_MS,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(VERIFIER_REQUEST_TIMEOUT_MS)]),
          headers: signerHeaders(apiTokens[index]),
        });
        if (completed) return;
        const attestor = String(response.data?.settlementAttestor || "").toLowerCase().replace(/^0x/, "");
        if (typeof response.data?.transactionHash !== "string" || !response.data.transactionHash.length || !eligible.has(attestor)) {
          throw new Error(`Verifier ${url} returned no valid settlement attestation`);
        }
        if (response.data.fallbackOnly !== undefined && typeof response.data.fallbackOnly !== "boolean") {
          throw new Error(`Verifier ${url} returned an invalid fallback mode`);
        }
        if (response.data.fallbackOnly === true && path !== "/v1/attest-deposit") {
          throw new Error(`Verifier ${url} returned an unexpected fallback attestation`);
        }
        accepted.add(attestor);
        if (response.data.fallbackOnly !== true) unrestricted.add(attestor);
      } catch (error) {
        if (completed) return;
        if (axios.isAxiosError(error) && error.response?.status === 409 && error.response?.data?.decision === "manual_review") {
          manualReviewRequired++;
        }
        logError("SettlementAttestation", error as Error, { chainId, verifierUrl: url, path });
      } finally {
        remaining--;
        // Prefer routing while outstanding responses can still complete a full quorum.
        if (!completed && (unrestricted.size >= threshold ||
          (accepted.size >= threshold && unrestricted.size + remaining < threshold))) {
          completed = true;
          logInfo("SettlementAttestation", `${accepted.size}/${urls.length} settlement verifiers accepted ${path}`);
          resolve(unrestricted.size < threshold);
          controller.abort();
        }
      }
    })).then(() => {
      if (completed) return;
      completed = true;
      reject(manualReviewRequired > 0
        ? new SettlementVerifierManualReviewRequired(
          `Settlement verifier manual review required for ${path}: ${manualReviewRequired}/${urls.length}`,
        )
        : new Error(`Settlement verifier threshold not reached for ${path}: ${accepted.size}/${threshold}`));
    });
  });
};

// Returns true when the collected quorum authorizes source-token fallback only.
export const attestDepositSettlement = async (
  deposit: DepositArgs | ActionDepositArgs,
): Promise<boolean> => {
  const actionDeposit = deposit as Partial<ActionDepositArgs>;
  return requestVerifierQuorum(
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
): Promise<void> => {
  await requestVerifierQuorum(
    authorization.destinationChainId,
    "/v1/attest-release",
    { authorization, reservationId, externalTxHash },
  );
};

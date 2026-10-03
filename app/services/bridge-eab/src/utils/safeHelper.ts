import SafeApiKit from "@safe-global/api-kit";
import Safe from "@safe-global/protocol-kit";
import { config, getChainRpcUrl } from "../config";
import { safeToBigInt } from "./utils";
import { KmsEip1193Provider, validateAwsKmsAddress } from "./kmsSigner";

export async function initializeSafeForChain(chainId: number, safeAddress?: string) {
  const rpcUrl = getChainRpcUrl(chainId);
  const proposerAddress = config.safe.safeProposerAddress || "";
  const keyId = config.safe.safeProposerKmsKeyId || "";
  const region = config.safe.safeProposerKmsRegion || "";
  if (!proposerAddress || !keyId || !region) {
    throw new Error("Safe proposer KMS configuration is incomplete");
  }
  const kmsConfig = { address: proposerAddress, keyId, region };
  await validateAwsKmsAddress(kmsConfig);
  const protocolKit = await Safe.init({
    provider: new KmsEip1193Provider(rpcUrl, kmsConfig),
    signer: proposerAddress,
    safeAddress: safeAddress || config.safe.address || "",
  });
  const apiKit = new SafeApiKit({ chainId: safeToBigInt(chainId), apiKey: config.safe.apiKey });

  return { protocolKit, apiKit };
}

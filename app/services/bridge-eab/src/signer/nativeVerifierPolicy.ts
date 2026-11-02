import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getAddress } from "ethers";

export interface NativeVerifierRoute {
  stratoToken: string;
  representationToken: string;
  instantEnabled: boolean;
  maxInstantAmount: string;
}

export interface NativeVerifierPolicy {
  version: string;
  baselinePolicyHash: string;
  verifierIndex: number;
  sourceChainId: string;
  sourceBridge: string;
  destinationChainId: string;
  destinationBridge: string;
  routes: NativeVerifierRoute[];
}

const uint = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be an unsigned integer string`);
  }
  return BigInt(value).toString();
};

const stratoAddress = (value: unknown, label: string): string => {
  const normalized = String(value || "").replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${label} must be a STRATO address`);
  }
  return normalized;
};

export const loadNativeVerifierPolicy = (
  filePath: string,
): { policy: NativeVerifierPolicy; digest: string } => {
  const source = readFileSync(filePath);
  const input = JSON.parse(source.toString()) as Partial<NativeVerifierPolicy>;
  if (!input.version?.trim()) throw new Error("Native verifier policy version is required");
  if (!/^sha256:[0-9a-f]{64}$/.test(String(input.baselinePolicyHash || ""))) {
    throw new Error("Native verifier policy baselinePolicyHash is invalid");
  }
  if (!Number.isSafeInteger(input.verifierIndex) || Number(input.verifierIndex) <= 0) {
    throw new Error("Native verifier policy verifierIndex must be positive");
  }
  const routes = (input.routes || []).map((route, index) => ({
    stratoToken: stratoAddress(route.stratoToken, `routes[${index}].stratoToken`),
    representationToken: getAddress(String(route.representationToken)),
    instantEnabled: route.instantEnabled === true,
    maxInstantAmount: uint(route.maxInstantAmount, `routes[${index}].maxInstantAmount`),
  }));
  const routeKeys = routes.map(
    (route) => `${route.stratoToken}:${route.representationToken.toLowerCase()}`,
  );
  if (new Set(routeKeys).size !== routeKeys.length) {
    throw new Error("Native verifier policy contains duplicate routes");
  }
  const baseline = {
    version: input.version,
    sourceChainId: input.sourceChainId,
    sourceBridge: input.sourceBridge,
    destinationChainId: input.destinationChainId,
    destinationBridge: input.destinationBridge,
    routes: input.routes,
  };
  const baselineHash = `sha256:${createHash("sha256").update(JSON.stringify(baseline)).digest("hex")}`;
  if (input.baselinePolicyHash !== baselineHash) {
    throw new Error("Native verifier baseline policy hash does not match policy limits");
  }
  return {
    policy: {
      version: input.version.trim(),
      baselinePolicyHash: input.baselinePolicyHash,
      verifierIndex: Number(input.verifierIndex),
      sourceChainId: uint(input.sourceChainId, "sourceChainId"),
      sourceBridge: stratoAddress(input.sourceBridge, "sourceBridge"),
      destinationChainId: uint(input.destinationChainId, "destinationChainId"),
      destinationBridge: getAddress(String(input.destinationBridge)),
      routes,
    },
    digest: `sha256:${createHash("sha256").update(source).digest("hex")}`,
  };
};

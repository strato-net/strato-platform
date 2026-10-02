import { keccak256 } from "../../utils/keccak256";
import { StratoError } from "../../errors/StratoError";

// Pure helpers for the validator -> operator consent flow (ValidatorRegistry.register /
// setOperator). Kept free of service imports so they can be unit tested directly.

// What a validator key signs: keccak256 of the packed prefix, registry, validator, operator
// and uint256 nonce, with no signed-message prefix (ValidatorRegistry.authorizationDigest).
export const AUTHORIZATION_PREFIX = "STRATO validator operator authorization";

const hex40 = (value: string): string => value.toLowerCase().replace(/^0x/, "");

export const authorizationDigest = (registry: string, validator: string, operator: string, nonce: bigint): string => {
  const packed = Buffer.concat([
    Buffer.from(AUTHORIZATION_PREFIX, "utf8"),
    Buffer.from(hex40(registry), "hex"),
    Buffer.from(hex40(validator), "hex"),
    Buffer.from(hex40(operator), "hex"),
    Buffer.from(nonce.toString(16).padStart(64, "0"), "hex"),
  ]);
  return `0x${keccak256(packed).toString("hex")}`;
};

const badRequest = (message: string): Error => {
  const error = new Error(message);
  (error as any).statusCode = 400;
  return error;
};

export type SplitSignature = { v: string; r: string; s: string };

// r || s || v as 130 hex characters. r and s travel as decimal strings (uint256
// parameters); v may be a recovery id (0/1) or 27/28, as the registry accepts both.
export const splitSignature = (signature: unknown): SplitSignature | null => {
  if (signature === undefined || signature === null || signature === "") return null;

  const hex = String(signature).trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{130}$/.test(hex)) {
    throw badRequest("signature must be 0x followed by 130 hex characters (r, s, v)");
  }
  const v = parseInt(hex.slice(128), 16);
  if (![0, 1, 27, 28].includes(v)) {
    throw badRequest("signature v must be 0, 1, 27 or 28");
  }

  return {
    r: BigInt(`0x${hex.slice(0, 64)}`).toString(),
    s: BigInt(`0x${hex.slice(64, 128)}`).toString(),
    v: String(v),
  };
};

// One operator runs one validator. The registry does not enforce this (helium's genesis
// validators share one operator), so the app refuses before posting. Returns the first
// ACTIVE record the account operates, or null. Addresses compare case-insensitively with or
// without 0x.
export const findOperatedValidator = <T extends { operator: string; active: boolean }>(
  records: T[],
  operator: string
): T | null => {
  const wanted = hex40(String(operator || ""));
  if (!wanted) return null;
  return records.find((record) => record.active && hex40(String(record.operator || "")) === wanted) ?? null;
};

// ValidatorRegistry reverts that a user can act on, in the order they are matched.
const REGISTRY_REVERTS: { needle: string; status: number; message: string }[] = [
  {
    needle: "VR: validator did not authorize operator",
    status: 409,
    message: "Authorization invalid or already used. Re-run strato-authorize-operator on the node.",
  },
  { needle: "VR: already registered", status: 409, message: "This validator is already listed. Use Change operator." },
  { needle: "VR: same operator", status: 409, message: "You already operate this validator." },
  { needle: "VR: validator missing", status: 404, message: "Validator not listed. Use Register." },
];

const errorText = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as any).message === "string") return (error as any).message;
  return "";
};

// A contract revert reaches the service as a StratoError whose message carries the revert
// string (txHelper.txFailureMessage). Translate the registry's consent reverts into a
// status and wording the UI can show as is; keep the original text in `detail`. Anything
// else is returned unchanged.
export const mapRegistryRevert = (error: unknown): unknown => {
  const text = errorText(error);
  const match = REGISTRY_REVERTS.find(({ needle }) => text.includes(needle));
  if (!match) return error;

  const mapped = new StratoError(match.message, match.status);
  (mapped as any).detail = text;
  return mapped;
};

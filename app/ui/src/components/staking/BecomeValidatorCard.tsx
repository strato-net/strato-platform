import { useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/axios";

export type RegisterValidatorInput = {
  // The validator's consensus (node) address. On the operator-keyed contract it is the
  // address bound to the caller's operator record.
  validator: string;
  name: string;
  description: string;
  commissionBps: string;
  // Validator-keyed contract only: the validator key's secp256k1 signature (0x + r||s||v) over
  // the authorization digest. Absent when the connected account is the validator itself.
  signature?: string;
};

type AuthorizationDigest = {
  registry: string;
  validator: string;
  operator: string;
  nonce: string;
  digest: string;
};

const SIGN_SCRIPT = "node app/contracts/deploy/sign-validator-authorization.js";

const isAddressLike = (value: string): boolean => /^(0x)?[0-9a-fA-F]{40}$/.test(value.trim());
const isSignatureLike = (value: string): boolean => /^0x[0-9a-fA-F]{130}$/.test(value.trim());
const normalizeAddress = (value: string | null | undefined): string => (value || "").trim().toLowerCase().replace(/^0x/, "");
const withHexPrefix = (value: string): string => (value.startsWith("0x") ? value : `0x${value}`);

const percentToBps = (value: string): string | null => {
  const raw = value.trim();
  if (!raw || !/^\d+(\.\d{0,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return (BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2))).toString();
};

const requestErrorMessage = (error: unknown): string => {
  const failure = error as { response?: { data?: { error?: string; message?: string } }; message?: string } | null;
  return failure?.response?.data?.error || failure?.response?.data?.message || failure?.message || "Could not load the authorization digest.";
};

const CopyValueButton = ({ value }: { value: string }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (e.g. insecure context); the value stays selectable on screen.
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={copy}>
      {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
};

type Props = {
  // Validator-keyed staking (V2) registers a validator with its key's consent; the
  // operator-keyed contract (V1) registers the caller as an operator.
  isV2: boolean;
  connectedAddress?: string | null;
  // V2: the caller already operates at least one validator.
  hasValidators?: boolean;
  minStake: string;
  // V2: how the self-bond requirement currently applies (grace deadline or active rule).
  requirementNote?: string;
  maxCommissionBps: string;
  symbol: string;
  disabled: boolean;
  submitting: boolean;
  onRegister: (input: RegisterValidatorInput) => Promise<boolean>;
};

// Permissionless registration. Joining the consensus set is a separate "Activate" step.
const BecomeValidatorCard = ({
  isV2,
  connectedAddress,
  hasValidators,
  minStake,
  requirementNote,
  maxCommissionBps,
  symbol,
  disabled,
  submitting,
  onRegister,
}: Props) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [commissionPercent, setCommissionPercent] = useState("");
  const [validatorAddress, setValidatorAddress] = useState("");
  const [signature, setSignature] = useState("");
  const [authorization, setAuthorization] = useState<AuthorizationDigest | null>(null);
  const [authorizationLoading, setAuthorizationLoading] = useState(false);
  const [authorizationError, setAuthorizationError] = useState("");
  const [authorizationReload, setAuthorizationReload] = useState(0);

  const validator = validatorAddress.trim();
  const validatorValid = isAddressLike(validator);
  // A registration sent by the validator key itself is its own consent.
  const selfAuthorized = validatorValid && normalizeAddress(connectedAddress) !== ""
    && normalizeAddress(validator) === normalizeAddress(connectedAddress);
  const needsConsent = isV2 && validatorValid && !selfAuthorized;

  useEffect(() => {
    if (!needsConsent) {
      setAuthorization(null);
      setAuthorizationError("");
      setAuthorizationLoading(false);
      return;
    }

    let cancelled = false;
    setAuthorization(null);
    setAuthorizationError("");
    setAuthorizationLoading(true);
    // The operator defaults to the caller, the same account that sends the registration.
    api.get<AuthorizationDigest>("/staking/authorization-digest", { params: { validator: withHexPrefix(validator) } })
      .then(({ data }) => {
        if (!cancelled) setAuthorization(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setAuthorizationError(requestErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setAuthorizationLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [needsConsent, validator, authorizationReload]);

  const commissionBps = percentToBps(commissionPercent);
  const signatureValue = signature.trim();
  const consentReady = !needsConsent || (!!authorization && isSignatureLike(signatureValue));
  const ready = !disabled && !submitting && commissionBps !== null
    && BigInt(commissionBps) <= BigInt(maxCommissionBps || "0") && validatorValid && consentReady;

  const operatorForCommand = authorization?.operator || connectedAddress || "<yourAddress>";
  const signCommand = authorization
    ? `${SIGN_SCRIPT} --validator ${authorization.validator || withHexPrefix(validator)} --operator ${operatorForCommand} --digest ${authorization.digest}`
    : "";

  const submit = async () => {
    const registered = await onRegister({
      validator,
      name,
      description,
      commissionBps: commissionBps || "0",
      ...(needsConsent ? { signature: signatureValue } : {}),
    });
    if (registered && isV2) {
      setName("");
      setDescription("");
      setCommissionPercent("");
      setValidatorAddress("");
      setSignature("");
    }
  };

  const validatorInput = (
    <Input
      value={validatorAddress}
      onChange={(event) => {
        setValidatorAddress(event.target.value);
        setSignature("");
      }}
      placeholder="Validator (node) address"
      disabled={submitting}
    />
  );

  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="text-lg font-semibold">{isV2 && hasValidators ? "Register another validator" : "Become a validator"}</h2>
        {isV2 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Register a validator node you run, self-bond at least {minStake} {symbol}, then activate to join the validator set.
            The validator address is your node's consensus key; you become its operator.
            {requirementNote ? ` ${requirementNote}` : ""}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Register your operator, bond at least {minStake} {symbol} (self-bond plus delegations), then activate to join the validator set.
            The validator address is your node's consensus key.
          </p>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {isV2 && validatorInput}
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Validator name" disabled={submitting} />
          <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description (optional)" disabled={submitting} />
          <Input
            value={commissionPercent}
            onChange={(event) => setCommissionPercent(event.target.value)}
            placeholder={`Commission % (max ${(Number(maxCommissionBps || "0") / 100).toFixed(2)}%)`}
            inputMode="decimal"
            disabled={submitting}
          />
          {!isV2 && validatorInput}
        </div>

        {isV2 && validatorValid && (
          <div className="mt-4 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Validator key consent</p>
            {selfAuthorized ? (
              <p className="mt-1 text-sm text-muted-foreground">
                You're connected as the validator address, so your registration transaction is its consent. No signature needed.
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  The validator key has to approve you as its operator. Sign the digest below on the validator node and paste the signature.
                  The digest is tied to your account and changes after each registration.
                </p>

                {authorizationLoading && (
                  <p className="mt-3 flex items-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading digest
                  </p>
                )}

                {authorizationError && (
                  <p className="mt-3 text-sm text-destructive">
                    {authorizationError}{" "}
                    <button
                      type="button"
                      className="font-medium underline"
                      onClick={() => setAuthorizationReload((current) => current + 1)}
                    >
                      Retry
                    </button>
                  </p>
                )}

                {authorization && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">Digest</span>
                        <CopyValueButton value={authorization.digest} />
                      </div>
                      <p className="mt-1 break-all rounded-md bg-muted/40 px-3 py-2 font-mono text-xs">{authorization.digest}</p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">Run on the validator node</span>
                        <CopyValueButton value={signCommand} />
                      </div>
                      <p className="mt-1 break-all rounded-md bg-muted/40 px-3 py-2 font-mono text-xs">{signCommand}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        The script signs with the node's key through its vault. Or sign the raw 32-byte digest with the
                        validator key directly, without any message prefix (not personal_sign).
                      </p>
                    </div>
                  </div>
                )}

                <Input
                  className="mt-3 font-mono"
                  value={signature}
                  onChange={(event) => setSignature(event.target.value)}
                  placeholder="Validator signature (0x + 130 hex characters)"
                  disabled={submitting || !authorization}
                />
                {signatureValue && !isSignatureLike(signatureValue) && (
                  <p className="mt-1 text-xs text-destructive">Expected 0x followed by 130 hex characters (r, s, v).</p>
                )}
              </>
            )}
          </div>
        )}

        <Button className="mt-4" size="sm" disabled={!ready} onClick={submit}>
          {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registering</>) : "Register"}
        </Button>
      </CardContent>
    </Card>
  );
};

export default BecomeValidatorCard;

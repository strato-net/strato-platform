import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/axios";
import { truncateAddress } from "@/utils/numberUtils";
import ValidatorStatusBadge from "@/components/staking/ValidatorStatusBadge";
import { describeValidatorNextStep, type ValidatorNextStepInput } from "@/components/staking/validatorNextStep";
import { AuthorizationInstructions } from "@/components/staking/AuthorizationInstructions";
import {
  isAddressLike,
  isSignatureLike,
  normalizeAddress,
  requestErrorMessage,
  withHexPrefix,
  type AuthorizationDigest,
} from "@/components/staking/authorization";

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

// The slice of a listed validator needed to show its status after registration.
export type RegisteredValidatorInfo = ValidatorNextStepInput & {
  address: string;
  name: string;
  jailedUntil?: string;
  exitReadyTime?: string;
};

const percentToBps = (value: string): string | null => {
  const raw = value.trim();
  if (!raw || !/^\d+(\.\d{0,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return (BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2))).toString();
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
  // V2 extras: listed validators (to show the new record's status after registering), the raw
  // minStake for that check, and whether joins are paused.
  validators?: RegisteredValidatorInfo[];
  minStakeRaw?: string;
  joinsPaused?: boolean;
  // Deep link from strato-authorize-operator: prefilled validator, signature and the nonce it was signed for.
  initialValidator?: string;
  initialSignature?: string;
  expectedNonce?: string;
  // Last backend error for this action, shown inline (the page also toasts it).
  errorMessage?: string | null;
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
  validators = [],
  minStakeRaw = "0",
  joinsPaused = false,
  initialValidator,
  initialSignature,
  expectedNonce,
  errorMessage,
}: Props) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [commissionPercent, setCommissionPercent] = useState("");
  const [validatorAddress, setValidatorAddress] = useState(initialValidator || "");
  const [signature, setSignature] = useState(initialSignature || "");
  const [authorization, setAuthorization] = useState<AuthorizationDigest | null>(null);
  const [authorizationLoading, setAuthorizationLoading] = useState(false);
  const [authorizationError, setAuthorizationError] = useState("");
  const [authorizationReload, setAuthorizationReload] = useState(0);
  // Validator just registered; its refreshed record is shown below the form.
  const [registeredValidator, setRegisteredValidator] = useState("");

  useEffect(() => {
    if (initialValidator) setValidatorAddress(initialValidator);
    if (initialSignature) setSignature(initialSignature);
  }, [initialValidator, initialSignature]);

  const validator = validatorAddress.trim();
  const validatorValid = isAddressLike(validator);
  const operator = normalizeAddress(connectedAddress);
  // A registration sent by the validator key itself is its own consent.
  const selfAuthorized = validatorValid && operator !== "" && normalizeAddress(validator) === operator;
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
    // The operator is the caller, the same account that sends the registration.
    api.get<AuthorizationDigest>("/staking/authorization-digest", {
      params: { validator: withHexPrefix(validator), ...(operator ? { operator: withHexPrefix(operator) } : {}) },
    })
      .then(({ data }) => {
        if (!cancelled) setAuthorization(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setAuthorizationError(requestErrorMessage(error, "Could not load the authorization digest."));
      })
      .finally(() => {
        if (!cancelled) setAuthorizationLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [needsConsent, operator, validator, authorizationReload]);

  const commissionBps = percentToBps(commissionPercent);
  const signatureValue = signature.trim();
  const staleNonce = !!authorization && expectedNonce !== undefined && expectedNonce !== "" && authorization.nonce !== expectedNonce
    && normalizeAddress(initialValidator) === normalizeAddress(validator);
  const consentReady = !needsConsent || (!!authorization && isSignatureLike(signatureValue) && !staleNonce);
  const ready = !disabled && !submitting && commissionBps !== null
    && BigInt(commissionBps) <= BigInt(maxCommissionBps || "0") && validatorValid && consentReady;

  const registered = registeredValidator
    ? validators.find((candidate) => normalizeAddress(candidate.address) === normalizeAddress(registeredValidator))
    : undefined;
  const nextStep = registered ? describeValidatorNextStep(registered, minStakeRaw, minStake, symbol, joinsPaused) : null;

  const submit = async () => {
    const done = await onRegister({
      validator,
      name,
      description,
      commissionBps: commissionBps || "0",
      ...(needsConsent ? { signature: signatureValue } : {}),
    });
    if (done && isV2) {
      setRegisteredValidator(validator);
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
        setRegisteredValidator("");
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
                  The validator key has to approve you as its operator. Run the command below on the validator node and paste the
                  signature it prints. Only your account can use it, and it expires once the validator's nonce moves.
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

                {authorization && <AuthorizationInstructions authorization={authorization} operator={operator || "<yourAddress>"} />}

                {staleNonce && (
                  <p className="mt-3 text-sm text-destructive">
                    This authorization is no longer valid; re-run the command on the node.
                  </p>
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

        {errorMessage && <p className="mt-3 text-sm text-destructive">{errorMessage}</p>}

        {registered && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
            <span>Registered {registered.name || truncateAddress(registered.address, 8, 6)}.</span>
            <ValidatorStatusBadge validator={registered} />
            {nextStep && <span className="text-muted-foreground">{nextStep}</span>}
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

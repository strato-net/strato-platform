import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/axios";
import { truncateAddress } from "@/utils/numberUtils";
import ValidatorStatusBadge from "@/components/staking/ValidatorStatusBadge";
import { describeValidatorNextStep, type ValidatorNextStepInput } from "@/components/staking/validatorNextStep";
import {
  CommandBlock,
  DigestDisclosure,
  OnboardingStep,
  PrefilledRow,
} from "@/components/staking/AuthorizationInstructions";
import {
  authorizeOperatorCommand,
  isAddressLike,
  isSignatureLike,
  normalizeAddress,
  requestErrorMessage,
  withHexPrefix,
  type AuthorizationDigest,
} from "@/components/staking/authorization";

const NODE_DOCS_URL = "https://docs.strato.nexus";

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

type Phase = "collapsed" | "guide" | "done";

// Permissionless registration, as a guided sequence: run a node, authorize this account from it,
// finish here. The validator address is never asked for up front: the node reveals it, and the
// link the node prints brings it back. Joining the consensus set is a separate "Activate" step.
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
  const linked = !!initialValidator;
  const [phase, setPhase] = useState<Phase>(linked ? "guide" : "collapsed");
  const [manual, setManual] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [commissionPercent, setCommissionPercent] = useState("");
  const [validatorAddress, setValidatorAddress] = useState(initialValidator || "");
  const [signature, setSignature] = useState(initialSignature || "");
  const [authorization, setAuthorization] = useState<AuthorizationDigest | null>(null);
  const [authorizationLoading, setAuthorizationLoading] = useState(false);
  const [authorizationError, setAuthorizationError] = useState("");
  const [authorizationReload, setAuthorizationReload] = useState(0);
  // Validator just registered; its refreshed record is shown in the done state.
  const [registeredValidator, setRegisteredValidator] = useState("");

  useEffect(() => {
    if (initialValidator) {
      setValidatorAddress(initialValidator);
      setPhase("guide");
      setManual(false);
    }
    if (initialSignature) setSignature(initialSignature);
  }, [initialValidator, initialSignature]);

  const validator = validatorAddress.trim();
  const validatorValid = isAddressLike(validator);
  const operator = normalizeAddress(connectedAddress);
  const command = authorizeOperatorCommand(withHexPrefix(operator || "<your address>"));
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
  const signatureValid = isSignatureLike(signatureValue);
  const staleNonce = !!authorization && expectedNonce !== undefined && expectedNonce !== "" && authorization.nonce !== expectedNonce
    && normalizeAddress(initialValidator) === normalizeAddress(validator);
  const consentReady = !needsConsent || (!!authorization && signatureValid && !staleNonce);
  // The node's answer is in hand (from the link, or typed) once both values are present.
  const authorized = validatorValid && (selfAuthorized || signatureValid);
  const ready = !disabled && !submitting && commissionBps !== null
    && BigInt(commissionBps) <= BigInt(maxCommissionBps || "0") && validatorValid && consentReady;

  const registered = registeredValidator
    ? validators.find((candidate) => normalizeAddress(candidate.address) === normalizeAddress(registeredValidator))
    : undefined;
  const nextStep = registered ? describeValidatorNextStep(registered, minStakeRaw, minStake, symbol, joinsPaused) : null;

  const reset = () => {
    setName("");
    setDescription("");
    setCommissionPercent("");
    setValidatorAddress("");
    setSignature("");
    setManual(false);
  };

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
      reset();
      setPhase("done");
    }
  };

  const title = isV2 && hasValidators ? "Register another validator" : "Become a validator";

  // ---- operator-keyed contract (V1): the plain form, unchanged behaviour ----
  if (!isV2) {
    return (
      <Card>
        <CardContent className="p-5">
          <h2 className="text-lg font-semibold">Become a validator</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Register your operator, bond at least {minStake} {symbol} (self-bond plus delegations), then activate to join the
            validator set. The validator address is your node's consensus key.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Validator name" disabled={submitting} />
            <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description (optional)" disabled={submitting} />
            <Input
              value={commissionPercent}
              onChange={(event) => setCommissionPercent(event.target.value)}
              placeholder={`Commission % (max ${(Number(maxCommissionBps || "0") / 100).toFixed(2)}%)`}
              inputMode="decimal"
              disabled={submitting}
            />
            <Input value={validatorAddress} onChange={(event) => setValidatorAddress(event.target.value)} placeholder="Validator (node) address" disabled={submitting} />
          </div>
          {errorMessage && <p className="mt-3 text-sm text-destructive">{errorMessage}</p>}
          <Button className="mt-4" size="sm" disabled={!ready} onClick={submit}>
            {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registering</>) : "Register"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---- done: compact confirmation, with a way back in ----
  if (phase === "done") {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">
              Registered {registered ? registered.name || truncateAddress(registered.address, 8, 6) : truncateAddress(registeredValidator, 8, 6)}.
            </span>
            {registered && <ValidatorStatusBadge validator={registered} />}
            {nextStep && <span className="text-muted-foreground">{nextStep}</span>}
          </div>
          <Button size="sm" variant="outline" onClick={() => { setRegisteredValidator(""); setPhase("guide"); }}>
            Register another
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---- collapsed: one sentence of what it takes, one button ----
  if (phase === "collapsed") {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Run a STRATO node and this account becomes its operator. You will need {minStake} {symbol} to self-bond and a
              little USDST for fees.{requirementNote ? ` ${requirementNote}` : ""}
            </p>
          </div>
          <Button size="sm" onClick={() => setPhase("guide")}>
            {hasValidators ? "Add a validator" : "Become a validator"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---- guide ----
  const showPrefilled = authorized && !manual;
  const stepOneState = authorized ? "done" : "current";
  const stepTwoState = authorized ? "done" : "current";

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Three steps. Your node proves it is yours; this account becomes its operator and pays the fees.
            </p>
          </div>
          {!linked && (
            <Button size="sm" variant="ghost" onClick={() => { reset(); setPhase("collapsed"); }}>
              Close
            </Button>
          )}
        </div>

        <ol className="mt-5 space-y-5">
          <OnboardingStep index={1} title="Run a STRATO node" state={stepOneState}>
            <p>
              Install and sync a node. Its key becomes the validator; it never leaves the node's vault.{" "}
              <a
                href={NODE_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
              >
                Node guide
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </OnboardingStep>

          <OnboardingStep index={2} title="Authorize this account from your node" state={stepTwoState}>
            <p>Run this on the node. It asks the node's vault to sign a one-time authorization for this account and prints a link back to this page.</p>
            <CommandBlock command={command} />
          </OnboardingStep>

          <OnboardingStep index={3} title="Finish here" state={authorized ? "current" : "todo"}>
            {showPrefilled ? (
              <div className="space-y-2">
                <PrefilledRow
                  label="Validator"
                  value={withHexPrefix(validator)}
                  note={linked ? "from your node" : undefined}
                  onChange={() => setManual(true)}
                />
                {selfAuthorized ? (
                  <p>You are connected as the validator key itself, so your transaction is its consent. No signature needed.</p>
                ) : (
                  <PrefilledRow label="Signature" value={`✓ ${truncateAddress(signatureValue, 10, 8)}`} />
                )}
              </div>
            ) : (
              <>
                <p>
                  Open the link the command printed; it brings you back here with the validator and signature filled in.
                  {" "}
                  <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setManual((value) => !value)}>
                    {manual ? "Hide manual entry" : "Enter them manually"}
                  </button>
                </p>
                {manual && (
                  <div className="grid gap-2">
                    <Input
                      value={validatorAddress}
                      onChange={(event) => {
                        setValidatorAddress(event.target.value);
                        setSignature("");
                      }}
                      placeholder="Validator address the command printed"
                      className="font-mono text-xs"
                      disabled={submitting}
                    />
                    {selfAuthorized ? (
                      <p>You are connected as the validator key itself, so your transaction is its consent. No signature needed.</p>
                    ) : (
                      <>
                        <Input
                          value={signature}
                          onChange={(event) => setSignature(event.target.value)}
                          placeholder="Signature the command printed (0x + 130 hex characters)"
                          className="font-mono text-xs"
                          disabled={submitting}
                        />
                        {signatureValue && !signatureValid && (
                          <p className="text-xs text-destructive">Expected 0x followed by 130 hex characters (r, s, v).</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {needsConsent && authorizationLoading && (
              <p className="flex items-center text-xs">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Checking the authorization
              </p>
            )}
            {needsConsent && authorizationError && (
              <p className="text-xs text-destructive">
                {authorizationError}{" "}
                <button type="button" className="font-medium underline" onClick={() => setAuthorizationReload((current) => current + 1)}>
                  Retry
                </button>
              </p>
            )}
            {staleNonce && (
              <p className="text-sm text-destructive">This authorization is no longer valid; re-run the command on the node.</p>
            )}
            {needsConsent && authorization && <DigestDisclosure authorization={authorization} />}

            {authorized && (
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Validator name" disabled={submitting} />
                <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description (optional)" disabled={submitting} />
                <Input
                  value={commissionPercent}
                  onChange={(event) => setCommissionPercent(event.target.value)}
                  placeholder={`Commission % (max ${(Number(maxCommissionBps || "0") / 100).toFixed(2)}%)`}
                  inputMode="decimal"
                  disabled={submitting}
                />
              </div>
            )}

            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

            <div>
              <Button className="mt-1" size="sm" disabled={!ready} onClick={submit}>
                {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registering</>) : "Register"}
              </Button>
              {authorized && !ready && !submitting && commissionBps === null && (
                <span className="ml-3 text-xs text-muted-foreground">Add a name and commission to register.</span>
              )}
            </div>
          </OnboardingStep>
        </ol>
      </CardContent>
    </Card>
  );
};

export default BecomeValidatorCard;

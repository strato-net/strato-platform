import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/axios";
import { truncateAddress } from "@/utils/numberUtils";
import ValidatorStatusBadge from "@/components/staking/ValidatorStatusBadge";
import { describeValidatorNextStep } from "@/components/staking/validatorNextStep";
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

export type ChangeOperatorInput = {
  validator: string;
  // Absent when the connected account is the validator key itself.
  signature?: string;
};

// The slice of a listed validator this card needs; the page's StakingValidator satisfies it.
export type ChangeOperatorValidator = {
  address: string;
  name: string;
  operator: string;
  status: 0 | 1 | 2 | 3;
  isValidator: boolean;
  isWaiter?: boolean;
  jailedUntil?: string;
  exitReadyTime?: string;
  selfBond: string;
};

type Props = {
  connectedAddress?: string | null;
  validators: ChangeOperatorValidator[];
  // Raw minStake (wei) for comparisons and its formatted label for text.
  minStake: string;
  minStakeLabel: string;
  symbol: string;
  joinsPaused: boolean;
  disabled: boolean;
  submitting: boolean;
  // Deep link from strato-authorize-operator: prefilled validator, signature and the nonce it was signed for.
  initialValidator?: string;
  initialSignature?: string;
  expectedNonce?: string;
  // Last backend error for this action, shown inline (the page also toasts it).
  errorMessage?: string | null;
  onChangeOperator: (input: ChangeOperatorInput) => Promise<boolean>;
};

type Phase = "collapsed" | "guide" | "done";

// Take over a listed validator: ValidatorRegistry.setOperator(validator, msg.sender, v, r, s).
// Same shape as registration: the node authorizes this account, the link brings the answer back,
// this account confirms. Anyone holding the signature can submit it, so the consequences are
// stated as information; the decision was made on the node when the key signed.
const ChangeOperatorCard = ({
  connectedAddress,
  validators,
  minStake,
  minStakeLabel,
  symbol,
  joinsPaused,
  disabled,
  submitting,
  initialValidator,
  initialSignature,
  expectedNonce,
  errorMessage,
  onChangeOperator,
}: Props) => {
  const linked = !!initialValidator;
  const [phase, setPhase] = useState<Phase>(linked ? "guide" : "collapsed");
  const [manual, setManual] = useState(false);
  const [validatorAddress, setValidatorAddress] = useState(initialValidator || "");
  const [signature, setSignature] = useState(initialSignature || "");
  const [authorization, setAuthorization] = useState<AuthorizationDigest | null>(null);
  const [authorizationLoading, setAuthorizationLoading] = useState(false);
  const [authorizationError, setAuthorizationError] = useState("");
  const [authorizationReload, setAuthorizationReload] = useState(0);
  // Validator whose operator change was just submitted; its refreshed record is shown in the done state.
  const [changedValidator, setChangedValidator] = useState("");

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
  const listed = validatorValid
    ? validators.find((candidate) => normalizeAddress(candidate.address) === normalizeAddress(validator))
    : undefined;
  const operator = normalizeAddress(connectedAddress);
  const command = authorizeOperatorCommand(withHexPrefix(operator || "<your address>"));
  const alreadyOperator = !!listed && normalizeAddress(listed.operator || listed.address) === operator && operator !== "";
  // A transaction sent by the validator key itself is its own consent.
  const selfAuthorized = validatorValid && operator !== "" && normalizeAddress(validator) === operator;
  const needsConsent = !!listed && !selfAuthorized && !alreadyOperator;

  useEffect(() => {
    if (!needsConsent || !operator) {
      setAuthorization(null);
      setAuthorizationError("");
      setAuthorizationLoading(false);
      return;
    }

    let cancelled = false;
    setAuthorization(null);
    setAuthorizationError("");
    setAuthorizationLoading(true);
    api.get<AuthorizationDigest>("/staking/authorization-digest", {
      params: { validator: withHexPrefix(validator), operator: withHexPrefix(operator) },
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

  const signatureValue = signature.trim();
  const signatureValid = isSignatureLike(signatureValue);
  const staleNonce = !!authorization && expectedNonce !== undefined && expectedNonce !== "" && authorization.nonce !== expectedNonce
    && normalizeAddress(initialValidator) === normalizeAddress(validator);
  const consentReady = !needsConsent || (!!authorization && signatureValid && !staleNonce);
  const authorized = validatorValid && (selfAuthorized || signatureValid);
  const ready = !disabled && !submitting && !!listed && !alreadyOperator && consentReady;

  const changed = changedValidator
    ? validators.find((candidate) => normalizeAddress(candidate.address) === normalizeAddress(changedValidator))
    : undefined;
  const nextStep = changed ? describeValidatorNextStep(changed, minStake, minStakeLabel, symbol, joinsPaused) : null;

  const reset = () => {
    setValidatorAddress("");
    setSignature("");
    setManual(false);
  };

  const submit = async () => {
    const done = await onChangeOperator({
      validator,
      ...(needsConsent ? { signature: signatureValue } : {}),
    });
    if (done) {
      setChangedValidator(validator);
      reset();
      setPhase("done");
    }
  };

  if (phase === "done") {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">
              You now operate {changed ? changed.name || truncateAddress(changed.address, 8, 6) : truncateAddress(changedValidator, 8, 6)}.
            </span>
            {changed && <ValidatorStatusBadge validator={changed} />}
            {nextStep && <span className="text-muted-foreground">{nextStep}</span>}
          </div>
          <Button size="sm" variant="outline" onClick={() => { setChangedValidator(""); setPhase("guide"); }}>
            Take over another
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (phase === "collapsed") {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Take over a validator</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Become the operator of a validator that is already listed. Its node authorizes this account; you confirm here.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setPhase("guide")}>
            Take over a validator
          </Button>
        </CardContent>
      </Card>
    );
  }

  const showPrefilled = authorized && !manual;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Take over a validator</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The validator's node authorizes this account; you confirm the change here and pay the fee.
            </p>
          </div>
          {!linked && (
            <Button size="sm" variant="ghost" onClick={() => { reset(); setPhase("collapsed"); }}>
              Close
            </Button>
          )}
        </div>

        <ol className="mt-5 space-y-5">
          <OnboardingStep index={1} title="Authorize this account from the validator's node" state={authorized ? "done" : "current"}>
            <p>Run this on the node you want to operate. Its vault signs a one-time authorization for this account and prints a link back to this page.</p>
            <CommandBlock command={command} />
          </OnboardingStep>

          <OnboardingStep index={2} title="Come back with the link" state={authorized ? "done" : "todo"}>
            {showPrefilled ? (
              <div className="space-y-2">
                <PrefilledRow
                  label="Validator"
                  value={withHexPrefix(validator)}
                  note={linked ? "from the node" : undefined}
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
                  The link fills in the validator and signature.{" "}
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
                    {!selfAuthorized && (
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
          </OnboardingStep>

          <OnboardingStep index={3} title="Confirm the change" state={authorized ? "current" : "todo"}>
            {validatorValid && !listed && (
              <p>This validator is not listed. Register it with "Become a validator" instead.</p>
            )}

            {listed && (
              <div className="rounded-md border border-border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">{listed.name || truncateAddress(listed.address, 8, 6)}</p>
                    <p className="text-xs">Current operator {truncateAddress(withHexPrefix(listed.operator || listed.address), 8, 6)}</p>
                  </div>
                  <ValidatorStatusBadge validator={listed} />
                </div>
              </div>
            )}

            {listed && alreadyOperator && <p>You already operate this validator.</p>}

            {listed && !alreadyOperator && (
              <>
                <p>
                  Anyone holding the signature can execute this change immediately. The current operator's self-bond is released
                  for unbonding and the validator may leave the consensus set until you self-bond at least {minStakeLabel} {symbol} and
                  activate.
                </p>
                {listed.status === 3 && (
                  <p>This validator is delisted. Changing its operator does not relist it; relisting needs an admin vote.</p>
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

            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

            <Button className="mt-1" size="sm" disabled={!ready} onClick={submit}>
              {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Changing</>) : "Change operator"}
            </Button>
          </OnboardingStep>
        </ol>
      </CardContent>
    </Card>
  );
};

export default ChangeOperatorCard;

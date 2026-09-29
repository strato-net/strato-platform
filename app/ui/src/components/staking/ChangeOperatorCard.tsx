import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/axios";
import { truncateAddress } from "@/utils/numberUtils";
import ValidatorStatusBadge from "@/components/staking/ValidatorStatusBadge";
import { describeValidatorNextStep } from "@/components/staking/validatorNextStep";
import { AuthorizationInstructions } from "@/components/staking/AuthorizationInstructions";
import {
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

// Take over a listed validator: ValidatorRegistry.setOperator(validator, msg.sender, v, r, s).
// Anyone holding the signature can submit it, so the consequences are stated as information;
// the decision was made on the node when the key signed.
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
  const [validatorAddress, setValidatorAddress] = useState(initialValidator || "");
  const [signature, setSignature] = useState(initialSignature || "");
  const [authorization, setAuthorization] = useState<AuthorizationDigest | null>(null);
  const [authorizationLoading, setAuthorizationLoading] = useState(false);
  const [authorizationError, setAuthorizationError] = useState("");
  const [authorizationReload, setAuthorizationReload] = useState(0);
  // Validator whose operator change was just submitted; its refreshed record is shown below.
  const [changedValidator, setChangedValidator] = useState("");

  useEffect(() => {
    if (initialValidator) setValidatorAddress(initialValidator);
    if (initialSignature) setSignature(initialSignature);
  }, [initialValidator, initialSignature]);

  const validator = validatorAddress.trim();
  const validatorValid = isAddressLike(validator);
  const listed = validatorValid
    ? validators.find((candidate) => normalizeAddress(candidate.address) === normalizeAddress(validator))
    : undefined;
  const operator = normalizeAddress(connectedAddress);
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
  const staleNonce = !!authorization && expectedNonce !== undefined && expectedNonce !== "" && authorization.nonce !== expectedNonce
    && normalizeAddress(initialValidator) === normalizeAddress(validator);
  const consentReady = !needsConsent || (!!authorization && isSignatureLike(signatureValue) && !staleNonce);
  const ready = !disabled && !submitting && !!listed && !alreadyOperator && consentReady;

  const changed = changedValidator
    ? validators.find((candidate) => normalizeAddress(candidate.address) === normalizeAddress(changedValidator))
    : undefined;
  const nextStep = changed ? describeValidatorNextStep(changed, minStake, minStakeLabel, symbol, joinsPaused) : null;

  const submit = async () => {
    const done = await onChangeOperator({
      validator,
      ...(needsConsent ? { signature: signatureValue } : {}),
    });
    if (done) {
      setChangedValidator(validator);
      setValidatorAddress("");
      setSignature("");
    }
  };

  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="text-lg font-semibold">Change operator</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Become the operator of a validator that is already listed. The validator key has to approve you: run the command
          below on its node and paste the signature. Your account submits the change and pays the fee.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Input
            value={validatorAddress}
            onChange={(event) => {
              setValidatorAddress(event.target.value);
              setSignature("");
              setChangedValidator("");
            }}
            placeholder="Validator (node) address"
            disabled={submitting}
          />
        </div>

        {validatorValid && !listed && (
          <p className="mt-3 text-sm text-muted-foreground">
            This validator is not listed. Register it with "Become a validator" instead.
          </p>
        )}

        {listed && (
          <div className="mt-4 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{listed.name || truncateAddress(listed.address, 8, 6)}</p>
                <p className="text-xs text-muted-foreground">
                  Current operator {truncateAddress(withHexPrefix(listed.operator || listed.address), 8, 6)}
                </p>
              </div>
              <ValidatorStatusBadge validator={listed} />
            </div>

            {alreadyOperator ? (
              <p className="mt-3 text-sm text-muted-foreground">You already operate this validator.</p>
            ) : (
              <>
                <p className="mt-3 text-sm text-muted-foreground">
                  Anyone holding the signature can execute this change immediately. The current operator's self-bond is
                  released for unbonding and the validator may leave the consensus set until you self-bond at least{" "}
                  {minStakeLabel} {symbol} and activate.
                </p>
                {listed.status === 3 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    This validator is delisted. Changing its operator does not relist it; relisting needs an admin vote.
                  </p>
                )}

                {selfAuthorized ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    You're connected as the validator address, so your transaction is its consent. No signature needed.
                  </p>
                ) : (
                  <>
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

                    {authorization && <AuthorizationInstructions authorization={authorization} operator={operator} />}

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
              </>
            )}
          </div>
        )}

        {errorMessage && <p className="mt-3 text-sm text-destructive">{errorMessage}</p>}

        {changed && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
            <span>You now operate {changed.name || truncateAddress(changed.address, 8, 6)}.</span>
            <ValidatorStatusBadge validator={changed} />
            {nextStep && <span className="text-muted-foreground">{nextStep}</span>}
          </div>
        )}

        <Button className="mt-4" size="sm" disabled={!ready} onClick={submit}>
          {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Changing</>) : "Change operator"}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ChangeOperatorCard;

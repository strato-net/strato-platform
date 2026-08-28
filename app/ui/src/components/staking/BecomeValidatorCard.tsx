import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type RegisterValidatorInput = {
  name: string;
  description: string;
  commissionBps: string;
  validatorAddress: string;
};

const isAddressLike = (value: string): boolean => /^(0x)?[0-9a-fA-F]{40}$/.test(value.trim());

const percentToBps = (value: string): string | null => {
  const raw = value.trim();
  if (!raw || !/^\d+(\.\d{0,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return (BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2))).toString();
};

type Props = {
  minStake: string;
  maxCommissionBps: string;
  symbol: string;
  disabled: boolean;
  submitting: boolean;
  onRegister: (input: RegisterValidatorInput) => Promise<void>;
};

// Permissionless registration: lists the caller as an operator so it can self-bond and
// receive delegations. Joining the consensus set is a separate "Activate" step.
const BecomeValidatorCard = ({ minStake, maxCommissionBps, symbol, disabled, submitting, onRegister }: Props) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [commissionPercent, setCommissionPercent] = useState("");
  const [validatorAddress, setValidatorAddress] = useState("");

  const commissionBps = percentToBps(commissionPercent);
  const ready = !disabled && !submitting && commissionBps !== null
    && BigInt(commissionBps) <= BigInt(maxCommissionBps || "0") && isAddressLike(validatorAddress);

  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="text-lg font-semibold">Become a validator</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Register your operator, bond at least {minStake} {symbol} (self-bond plus delegations), then activate to join the validator set.
          The validator address is your node's consensus key.
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
          <Input
            value={validatorAddress}
            onChange={(event) => setValidatorAddress(event.target.value)}
            placeholder="Validator (node) address"
            disabled={submitting}
          />
        </div>
        <Button
          className="mt-4"
          size="sm"
          disabled={!ready}
          onClick={() => onRegister({ name, description, commissionBps: commissionBps || "0", validatorAddress: validatorAddress.trim() })}
        >
          {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registering</>) : "Register"}
        </Button>
      </CardContent>
    </Card>
  );
};

export default BecomeValidatorCard;

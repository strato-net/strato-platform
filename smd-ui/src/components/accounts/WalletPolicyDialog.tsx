import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Shield, Plus, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { CopyButton } from "@/components/CopyButton";
import { AddressInput } from "@/components/AddressInput";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";
import { useContractState, compileContract } from "@/services/contracts";
import {
  generatePolicySource,
  strip0x,
  ZERO_ADDRESS,
  type PolicyTemplate,
  type DefaultAction,
  type UserWallet,
} from "@/services/userWallets";

function isZero(addr?: string): boolean {
  return !addr || /^0x?0*$/.test(addr.replace(/^0x/, "0x"));
}

export function WalletPolicyDialog({ wallet }: { wallet: UserWallet }) {
  const [open, setOpen] = useState(false);
  const { submit, canSubmit, isAppAuthenticated } = useSubmitTransaction();
  const queryClient = useQueryClient();

  const { data: state } = useContractState(open ? "User" : null, open ? wallet.address : null);
  const currentLogic = (state?.["logicContract"] as string | undefined) ?? "";

  // Set-existing-address form
  const [rawAddress, setRawAddress] = useState("");
  const [settingRaw, setSettingRaw] = useState(false);

  // Template builder
  const [template, setTemplate] = useState<PolicyTemplate>("allowlist");
  const [handler, setHandler] = useState("onCall");
  const [defaultAction, setDefaultAction] = useState<DefaultAction>("reject");
  const [addresses, setAddresses] = useState<{ text: string; addr: string }[]>([
    { text: "", addr: "" },
  ]);
  const [showSource, setShowSource] = useState(false);
  const [busy, setBusy] = useState(false);

  const contractName = useMemo(
    () => `${(wallet.username || "Wallet").replace(/[^A-Za-z0-9_]/g, "")}Policy`,
    [wallet.username]
  );

  const source = useMemo(
    () =>
      generatePolicySource(template, {
        contractName,
        handler,
        addresses: addresses.map((a) => a.addr || a.text),
        defaultAction,
      }),
    [template, contractName, handler, addresses, defaultAction]
  );

  const callSetLogic = async (logicAddress: string) => {
    // setLogicContract is onlyOwner; the connected account owns the wallet, so call
    // it directly on the wallet (no username wrapping needed).
    await submit("FUNCTION", {
      contractName: "User",
      contractAddress: wallet.address,
      value: 0,
      method: "setLogicContract",
      args: { _logicContract: strip0x(logicAddress) },
      metadata: {},
    });
    queryClient.invalidateQueries({ queryKey: ["contract-state", "User", wallet.address] });
  };

  const setRaw = async () => {
    const addr = strip0x(rawAddress);
    if (addr.length !== 40) {
      toast.error("Enter a valid contract address");
      return;
    }
    setSettingRaw(true);
    try {
      await callSetLogic(addr);
      toast.success("Logic contract updated");
      setRawAddress("");
    } catch (err: any) {
      toast.error("Failed to set logic contract", { description: String(err?.message || err) });
    } finally {
      setSettingRaw(false);
    }
  };

  const clearLogic = async () => {
    setSettingRaw(true);
    try {
      await callSetLogic(ZERO_ADDRESS);
      toast.success("Logic contract cleared");
    } catch (err: any) {
      toast.error("Failed to clear logic contract", { description: String(err?.message || err) });
    } finally {
      setSettingRaw(false);
    }
  };

  const deployAndSet = async () => {
    setBusy(true);
    try {
      // Validate first so the user gets a compile error before signing anything.
      await compileContract(contractName, source);
      // External wallets can't deploy raw contracts; route the deploy through this
      // User wallet's createContract (username), STRATO wallets deploy directly.
      const result = await submit(
        "CONTRACT",
        { contract: contractName, src: source, args: {}, metadata: { VM: "SolidVM" } },
        isAppAuthenticated ? undefined : { username: wallet.username }
      );
      const deployed: string | undefined =
        result?.data?.contents?.address ?? result?.address ?? result?.contents?.address;
      if (!deployed) {
        throw new Error(
          "Deployed the logic contract, but couldn't read its address from the result. " +
            "Find it in the Explorer and paste it into \"Set to existing address\" above."
        );
      }
      await callSetLogic(deployed);
      toast.success("Policy deployed and applied", { description: deployed });
    } catch (err: any) {
      const msg = typeof err === "string" ? err : String(err?.message || err);
      toast.error("Policy deploy failed", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const updateAddress = (i: number, text: string, addr: string) =>
    setAddresses((prev) => prev.map((a, idx) => (idx === i ? { text, addr } : a)));
  const addAddress = () => setAddresses((prev) => [...prev, { text: "", addr: "" }]);
  const removeAddress = (i: number) =>
    setAddresses((prev) =>
      prev.length === 1 ? [{ text: "", addr: "" }] : prev.filter((_, idx) => idx !== i)
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Shield className="h-3.5 w-3.5" />
          Policy
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Wallet policy — {wallet.username || "User"}</DialogTitle>
          <DialogDescription>
            Set the logic contract your wallet delegates to. When another account calls a
            function your wallet doesn't define, the wallet forwards it to this contract so it
            can react.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Current logic contract */}
          <div>
            <Label className="text-muted-foreground">Current logic contract</Label>
            <div className="mt-1 flex items-center gap-2">
              {isZero(currentLogic) ? (
                <span className="text-sm text-muted-foreground">None</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 break-all font-mono text-xs">
                  {currentLogic}
                  <CopyButton value={currentLogic} />
                </span>
              )}
              {!isZero(currentLogic) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearLogic}
                  disabled={settingRaw || !canSubmit}
                  className="ml-auto"
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>

          {/* Set existing address */}
          <div className="space-y-2">
            <Label htmlFor="raw-logic">Set to existing address</Label>
            <div className="flex items-center gap-2">
              <Input
                id="raw-logic"
                placeholder="0x… deployed logic contract"
                value={rawAddress}
                onChange={(e) => setRawAddress(e.target.value)}
                className="font-mono text-xs"
              />
              <Button onClick={setRaw} disabled={settingRaw || !canSubmit || !rawAddress.trim()}>
                Set
              </Button>
            </div>
          </div>

          <Separator />

          {/* Guided template builder */}
          <div className="space-y-3">
            <div className="text-sm font-medium">Build a new policy</div>

            <Field label="Policy">
              <Select value={template} onValueChange={(v) => setTemplate(v as PolicyTemplate)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allowlist">Allowlist callers</SelectItem>
                  <SelectItem value="reject">Reject all calls</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Handler">
              <Input
                value={handler}
                onChange={(e) => setHandler(e.target.value)}
                placeholder="onCall"
              />
            </Field>

            {template === "allowlist" ? (
              <>
                <Field label="Non-listed">
                  <Select
                    value={defaultAction}
                    onValueChange={(v) => setDefaultAction(v as DefaultAction)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reject">Reject (allowlist)</SelectItem>
                      <SelectItem value="allow">Allow (blocklist)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <div>
                  <Label className="text-muted-foreground">Addresses</Label>
                  <div className="mt-1 space-y-2">
                    {addresses.map((a, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <AddressInput
                          value={a.text}
                          resolved={a.addr}
                          onChange={(text, addr) => updateAddress(i, text, addr)}
                          placeholder="0x… address or username"
                          className="font-mono text-xs"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeAddress(i)}
                          aria-label="Remove address"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={addAddress} className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" />
                      Add address
                    </Button>
                  </div>
                </div>
              </>
            ) : null}

            <div>
              <Button variant="ghost" size="sm" onClick={() => setShowSource((s) => !s)}>
                {showSource ? "Hide" : "Show"} generated source
              </Button>
              {showSource ? (
                <pre className="mt-1 max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">
                  {source}
                </pre>
              ) : null}
            </div>

            <Button onClick={deployAndSet} disabled={busy || !canSubmit} className="w-full">
              {busy ? "Deploying…" : "Deploy & set logic"}
            </Button>
            {!canSubmit ? (
              <p className="text-xs text-muted-foreground">Connect a wallet to update the policy.</p>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
      <Label className="text-right text-muted-foreground">{label}</Label>
      <div>{children}</div>
    </div>
  );
}

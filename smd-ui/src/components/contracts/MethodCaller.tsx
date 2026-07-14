import { useState } from "react";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressInput } from "@/components/AddressInput";
import { WalletSelect } from "@/components/contracts/WalletSelect";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";
import { useUser } from "@/context/UserContext";
import type { FuncArg } from "@/services/contracts";

interface MethodCallerProps {
  contractName: string;
  contractAddress: string;
  method: string;
  args: FuncArg[];
  payable?: boolean;
  signature?: string;
}

type CallResult = any;

/** A bare address/account parameter (not an array of them). */
const isPlainAddressType = (t: string) => /^(address|account)$/i.test(t.trim());

export function MethodCaller({
  contractName,
  contractAddress,
  method,
  args,
  payable,
  signature,
}: MethodCallerProps) {
  const { userAddress } = useUser();
  const { submit: submitTx, canSubmit } = useSubmitTransaction();

  const [open, setOpen] = useState(false);
  // "" = call directly from the connected account; otherwise route the call through
  // this User wallet (the node wraps it as wallet.callContract).
  const [walletUsername, setWalletUsername] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [value, setValue] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [resolvedAddrs, setResolvedAddrs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);
  const [error, setError] = useState<string>("");

  const submit = async () => {
    const parsed: Record<string, unknown> = {};
    for (const a of args) {
      const isAddressArg = isPlainAddressType(a.type);
      // Address params may have been entered as a username — use the resolution.
      const raw = isAddressArg ? resolvedAddrs[a.name] || values[a.name] : values[a.name];
      if (raw === undefined || raw === "") continue;
      // Keep string- and address-typed params verbatim ("123" stays a string;
      // an all-digit address must not become a number); everything else gets a
      // JSON parse attempt ("123" -> 123, "[1,2]" -> array) with raw fallback.
      let parsedValue: unknown = raw;
      if (a.type !== "string" && !isAddressArg) {
        try {
          parsedValue = JSON.parse(raw);
        } catch {
          parsedValue = raw;
        }
      }
      // Wrap with the declared Solidity type so bloc doesn't have to guess
      // (e.g. "0x64" is an address, not the number 100).
      parsed[a.name] = a.type ? { type: a.type, value: parsedValue } : parsedValue;
    }
    setPending(true);
    setResult(null);
    setError("");
    try {
      const res = await submitTx(
        "FUNCTION",
        {
          contractName,
          contractAddress,
          value: payable && value ? Number(value) : 0,
          method,
          args: parsed,
          metadata: {},
        },
        walletUsername ? { username: walletUsername } : undefined
      );
      setResult(res);
      toast.success(`Called ${method}`);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : String(err?.message || err);
      setError(msg);
      toast.error(`${method} failed`, { description: msg });
    } finally {
      setPending(false);
    }
  };

  const returned = result?.data?.contents;

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Wand2 className="h-3.5 w-3.5 shrink-0" />
        <span className="font-mono">{method}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Call '{method}' on {contractName}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Field label="Contract Address">
              <span className="break-all font-mono text-xs">{contractAddress}</span>
            </Field>

            <Field label="Caller Address">
              <span className="break-all font-mono text-xs text-muted-foreground">
                {userAddress || "Connect a wallet"}
              </span>
            </Field>

            <Field label="Wallet">
              <WalletSelect value={walletUsername} onChange={setWalletUsername} />
            </Field>

            {signature ? (
              <div>
                <Button variant="outline" size="sm" onClick={() => setShowSource((s) => !s)}>
                  {showSource ? "Hide" : "Show"} Function Source Code
                </Button>
                {showSource ? (
                  <pre className="mt-2 overflow-auto rounded-md bg-muted p-3 text-xs">
                    function {method} {signature}
                  </pre>
                ) : null}
              </div>
            ) : null}

            {payable ? (
              <Field label="Value (wei)">
                <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
              </Field>
            ) : null}

            <div>
              <div className="mb-2 text-sm font-medium">Parameters</div>
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {args.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-3 py-3 text-center text-muted-foreground">
                          This method has no parameters
                        </td>
                      </tr>
                    ) : (
                      args.map((a) => (
                        <tr key={a.name} className="border-t border-border">
                          <td className="px-3 py-2 align-top">
                            <div className="pt-1.5">{a.name}</div>
                          </td>
                          <td className="px-2 py-1.5">
                            {isPlainAddressType(a.type) ? (
                              <AddressInput
                                value={values[a.name] ?? ""}
                                resolved={resolvedAddrs[a.name] ?? ""}
                                onChange={(text, addr) => {
                                  setValues((v) => ({ ...v, [a.name]: text }));
                                  setResolvedAddrs((v) => ({ ...v, [a.name]: addr }));
                                }}
                                placeholder={a.type}
                                className="h-8"
                              />
                            ) : (
                              <Input
                                value={values[a.name] ?? ""}
                                onChange={(e) =>
                                  setValues((v) => ({ ...v, [a.name]: e.target.value }))
                                }
                                placeholder={a.type}
                                className="h-8"
                              />
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {result ? (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <div className="font-medium">Transaction Result</div>
                <div className="mt-1 text-xs">Status: {result?.status ?? "Success"}</div>
                {result?.hash ? (
                  <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {result.hash}
                  </div>
                ) : null}
                {returned != null ? (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">
                    {JSON.stringify(returned, null, 2)}
                  </pre>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </pre>
            ) : null}

            {!canSubmit ? (
              <p className="text-xs text-muted-foreground">
                Connect a wallet (STRATO or external) to call this method.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || !canSubmit}>
              {pending ? "Calling…" : "Call Method"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-3">
      <Label className="text-right text-muted-foreground">{label}</Label>
      <div>{children}</div>
    </div>
  );
}

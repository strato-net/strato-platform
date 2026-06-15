import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";

interface MethodCallerProps {
  contractName: string;
  contractAddress: string;
  method: string;
  args: Record<string, { type: string }>;
}

export function MethodCaller({ contractName, contractAddress, method, args }: MethodCallerProps) {
  const argNames = Object.keys(args || {});
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const { submit: submitTx, canSubmit } = useSubmitTransaction();

  const submit = async () => {
    setPending(true);
    try {
      const result = await submitTx("FUNCTION", {
        contractName,
        contractAddress,
        value: 0,
        method,
        args: values,
        metadata: {},
      });
      toast.success(`Called ${method}`, {
        description: result?.data?.contents?.toString?.() ?? "Success",
      });
    } catch (err: any) {
      toast.error(`${method} failed`, { description: err?.message || "Call failed" });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 font-mono text-sm font-medium">{method}</div>
      <div className="space-y-2">
        {argNames.map((arg) => (
          <div key={arg} className="space-y-1">
            <Label htmlFor={`${method}-${arg}`} className="text-xs">
              {arg} <span className="text-muted-foreground">({args[arg].type})</span>
            </Label>
            <Input
              id={`${method}-${arg}`}
              value={values[arg] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [arg]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <Button size="sm" className="mt-3" onClick={submit} disabled={pending || !canSubmit}>
        {pending ? "Calling…" : "Call"}
      </Button>
    </div>
  );
}

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authorizeOperatorCommand, withHexPrefix, type AuthorizationDigest } from "@/components/staking/authorization";

export const CopyValueButton = ({ value }: { value: string }) => {
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

// Digest and the command that produces its signature, as shown in both consent cards.
export const AuthorizationInstructions = ({ authorization, operator }: { authorization: AuthorizationDigest; operator: string }) => {
  const command = authorizeOperatorCommand(withHexPrefix(operator));
  return (
    <div className="mt-3 space-y-3">
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Run on the validator node</span>
          <CopyValueButton value={command} />
        </div>
        <p className="mt-1 break-all rounded-md bg-muted/40 px-3 py-2 font-mono text-xs">{command}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The command signs with the node's key through its vault and prints the signature. It never exports the key.
        </p>
      </div>
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Digest (nonce {authorization.nonce})</span>
          <CopyValueButton value={authorization.digest} />
        </div>
        <p className="mt-1 break-all rounded-md bg-muted/40 px-3 py-2 font-mono text-xs">{authorization.digest}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          For a key held outside a vault: sign these raw 32 bytes with the validator key, no message prefix (not personal_sign).
        </p>
      </div>
    </div>
  );
};

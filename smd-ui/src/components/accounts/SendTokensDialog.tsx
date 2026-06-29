import { useEffect, useMemo, useState } from "react";
import { parseUnits, formatUnits, isAddress } from "viem";
import { toast } from "sonner";
import { Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUser } from "@/context/UserContext";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";
import { useMyTokens } from "@/services/tokens";
import { useMyUserWallets } from "@/services/userWallets";
import { useUserSearch } from "@/services/accounts";
import { shortenHex } from "@/lib/utils";

const DIRECT = "direct";
const PERCENTS = [25, 50, 75, 100] as const;

function isAddressLike(s: string): boolean {
  return /^(0x)?[0-9a-fA-F]{40}$/.test(s.trim());
}

export function SendTokensDialog({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const { userAddress } = useUser();
  const { submit } = useSubmitTransaction();

  // Send-from wallet: "direct" (connected account) or a User wallet contract address.
  const [fromWallet, setFromWallet] = useState(DIRECT);
  const { data: wallets } = useMyUserWallets(userAddress);
  const wallet = wallets?.find((w) => w.address === fromWallet);
  const holder = fromWallet === DIRECT ? userAddress : fromWallet;
  const walletUsername = fromWallet === DIRECT ? "" : wallet?.username ?? "";

  // Token balances belong to the selected sender (refetched when `holder` changes).
  const { data: tokens } = useMyTokens(holder);
  const [symbol, setSymbol] = useState("");
  const token = tokens?.find((t) => t.symbol === symbol);
  const maxDisplay = token ? formatUnits(BigInt(token.balance), token.decimals) : null;

  // Keep a valid token selected as the list changes (e.g. when the sender changes).
  useEffect(() => {
    if (!tokens?.length) return;
    if (!tokens.some((t) => t.symbol === symbol)) setSymbol(tokens[0].symbol);
  }, [tokens, symbol]);

  // Recipient: free text that's either an address or a username to search.
  const [recipient, setRecipient] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTerm = isAddressLike(recipient) ? "" : recipient;
  const { data: userMatches } = useUserSearch(searchTerm);

  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ to?: string; amount?: string }>({});

  const resolvedTo = isAddressLike(recipient) ? recipient.replace(/^0x/, "") : recipientAddress;

  const onPickUser = (u: { username: string; address: string }) => {
    setRecipient(u.username);
    setRecipientAddress(u.address);
    setShowSuggestions(false);
  };

  const setPercent = (pct: number) => {
    if (!token) return;
    const portion = (BigInt(token.balance) * BigInt(pct)) / 100n;
    setAmount(formatUnits(portion, token.decimals));
    setError((e) => ({ ...e, amount: undefined }));
  };

  const reset = () => {
    setRecipient("");
    setRecipientAddress("");
    setAmount("");
    setError({});
  };

  const onSubmit = async () => {
    const errs: { to?: string; amount?: string } = {};
    if (!resolvedTo || !isAddress(`0x${resolvedTo}`)) {
      errs.to = "Enter a valid address or pick a user";
    }
    if (!token) {
      toast.error("Select a token");
      return;
    }
    let raw = 0n;
    try {
      raw = parseUnits(amount, token.decimals);
      if (raw <= 0n) throw new Error();
    } catch {
      errs.amount = "Enter a positive amount";
    }
    if (!errs.amount && raw > BigInt(token.balance)) {
      errs.amount = `Amount exceeds balance (${maxDisplay} ${token.symbol})`;
    }
    if (errs.to || errs.amount) {
      setError(errs);
      return;
    }

    setPending(true);
    try {
      await submit(
        "FUNCTION",
        {
          contractName: token.symbol,
          contractAddress: token.address,
          value: 0,
          method: "transfer",
          args: { to: resolvedTo, value: raw.toString() },
          metadata: {},
        },
        walletUsername ? { username: walletUsername } : undefined
      );
      toast.success(`Sent ${amount} ${token.symbol}`);
      reset();
      setOpen(false);
    } catch (err: any) {
      toast.error("Transfer failed", { description: String(err?.message || err) });
    } finally {
      setPending(false);
    }
  };

  const suggestions = useMemo(() => (userMatches ?? []).slice(0, 6), [userMatches]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled} className="gap-2">
          <Send className="h-4 w-4" />
          Send tokens
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send tokens</DialogTitle>
          <DialogDescription>Transfer a token from your account or a User wallet.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Send from */}
          <div className="space-y-2">
            <Label htmlFor="from-wallet">Send from</Label>
            <Select value={fromWallet} onValueChange={setFromWallet}>
              <SelectTrigger id="from-wallet">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DIRECT}>Direct (no wallet)</SelectItem>
                {(wallets ?? []).map((w) => (
                  <SelectItem key={w.address} value={w.address}>
                    {w.username || shortenHex(w.address)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Token */}
          <div className="space-y-2">
            <Label htmlFor="token">Token</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger id="token">
                <SelectValue placeholder={tokens?.length ? "Select a token" : "No tokens"} />
              </SelectTrigger>
              <SelectContent>
                {(tokens ?? []).map((t) => (
                  <SelectItem key={t.address} value={t.symbol}>
                    {t.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Recipient with username autocomplete */}
          <div className="relative space-y-2">
            <Label htmlFor="toAddress">Recipient address or username</Label>
            <Input
              id="toAddress"
              placeholder="0x… or username"
              autoComplete="off"
              value={recipient}
              onChange={(e) => {
                const v = e.target.value;
                setRecipient(v);
                setRecipientAddress(isAddressLike(v) ? v.replace(/^0x/, "") : "");
                setShowSuggestions(true);
                setError((er) => ({ ...er, to: undefined }));
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            />
            {showSuggestions && suggestions.length > 0 ? (
              <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
                {suggestions.map((u) => (
                  <button
                    type="button"
                    key={u.address}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onPickUser(u)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-medium">{u.username}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {shortenHex(u.address)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {recipientAddress && !isAddressLike(recipient) ? (
              <p className="font-mono text-xs text-muted-foreground">→ {recipientAddress}</p>
            ) : null}
            {error.to ? <p className="text-xs text-destructive">{error.to}</p> : null}
          </div>

          {/* Amount + percentage buttons */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="amount">Amount</Label>
              {maxDisplay ? (
                <span className="text-xs text-muted-foreground">
                  Balance: {maxDisplay} {token?.symbol}
                </span>
              ) : null}
            </div>
            <Input
              id="amount"
              placeholder="0.0"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError((er) => ({ ...er, amount: undefined }));
              }}
            />
            <div className="flex gap-2">
              {PERCENTS.map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={!token}
                  onClick={() => setPercent(p)}
                >
                  {p === 100 ? "Max" : `${p}%`}
                </Button>
              ))}
            </div>
            {error.amount ? <p className="text-xs text-destructive">{error.amount}</p> : null}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onSubmit} disabled={pending || !token}>
            {pending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

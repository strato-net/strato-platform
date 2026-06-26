import React, { useEffect, useMemo, useState } from "react";
import { formatEther, formatUnits, parseUnits, type Address } from "viem";
import QRCode from "qrcode";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ArrowUpDown,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  Coins,
  Copy,
  DollarSign,
  KeyRound,
  LogOut,
  Moon,
  Pencil,
  Plus,
  QrCode as QrCodeIcon,
  Settings as SettingsIcon,
  ShieldAlert,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { callBackground } from "@/src/messaging/control";
import type { AccountMeta, HdWalletInfo } from "@/src/core/keyring";
import {
  type StratoNetwork,
  nativeSymbol,
  explorerTxUrl,
  isStratoNetwork,
  isTestnet,
} from "@/src/core/networks";
import type { OriginPermission } from "@/src/core/permissions";
import type { ActivityItem } from "@/src/core/activity";
import type { TokenBalance, DefiPosition } from "@/src/core/portfolio";
import {
  type SwapPool,
  type SwapToken,
  quoteOut,
  findPool,
} from "@/src/core/swap-quote";
import type { BridgeRoute, BridgeConfig, BridgeHistoryItem } from "@/src/core/bridge";
import {
  Avatar,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Logo,
  openTab,
  shortAddr,
} from "./components";
import { useAsync, useCopy, useTheme } from "./hooks";

const STRATO_DEFI_URL = "https://app.strato.nexus";
const FALLBACK_SYMBOL = "USDST";

function fmtBalance(hex?: string): string {
  if (!hex) return "0";
  try {
    const n = Number(formatEther(BigInt(hex)));
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  } catch {
    return "0";
  }
}

// ------------------------------------------------------------- small bits
function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
    >
      {children}
    </button>
  );
}

function ScreenHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-3 py-3">
      <button
        onClick={onClose}
        aria-label="Back"
        className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <span className="text-sm font-semibold">{title}</span>
      <button
        onClick={onClose}
        aria-label="Close"
        className="flex h-8 w-8 items-center justify-center rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-900"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-1 flex-col items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 py-3 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-slate-100 dark:hover:bg-slate-900"
    >
      <span className="text-[#001B70] dark:text-blue-300">{icon}</span>
      {label}
    </button>
  );
}

function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, copy] = useCopy();
  return (
    <button
      onClick={() => copy(value)}
      aria-label="Copy"
      className={className ?? "text-slate-400 hover:text-slate-600"}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// --------------------------------------------------------------------- Home
type HomeTab = "tokens" | "defi" | "activity";

// Networks to show in a selector: hide testnets unless the toggle is on, but
// always keep the currently-selected network visible (e.g. a dApp switched the
// wallet to a testnet while the toggle is off).
function visibleNetworks(
  all: StratoNetwork[] | undefined,
  showTestnets: boolean | undefined,
  selectedId: string | undefined
): StratoNetwork[] {
  return (all ?? []).filter(
    (n) => showTestnets || !isTestnet(n) || n.id === selectedId
  );
}

export function Home({ navigate }: { navigate: (to: string) => void }) {
  const accounts = useAsync<AccountMeta[]>(() => callBackground("accounts.list"));
  const selected = useAsync<Address | null>(() => callBackground("accounts.selected"));
  const networks = useAsync<StratoNetwork[]>(() => callBackground("networks.list"));
  const network = useAsync<StratoNetwork>(() => callBackground("networks.selected"));
  const showTestnets = useAsync<boolean>(() => callBackground("settings.showTestnets"));
  const unread = useAsync<number>(() => callBackground("notifications.unreadCount"));
  const [tab, setTab] = useState<HomeTab>("tokens");
  const [copied, copy] = useCopy();
  const [theme, toggleTheme] = useTheme();

  const symbol = network.data ? nativeSymbol(network.data) : FALLBACK_SYMBOL;
  const swapEnabled = network.data ? isStratoNetwork(network.data) : true;
  const addr = selected.data ?? null;
  const current = (accounts.data ?? []).find(
    (a) => a.address.toLowerCase() === (addr ?? "").toLowerCase()
  );
  const balance = useAsync<string>(
    async () => (addr ? callBackground<string>("balance", addr) : "0x0"),
    [addr, network.data?.chainId]
  );

  return (
    <div className="flex flex-col">
      {/* top bar: account selector + settings */}
      <div className="flex items-center justify-between px-3 pt-3">
        <button
          onClick={() => navigate("accounts")}
          className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-900"
        >
          <Avatar address={addr} size={24} />
          <span className="text-sm font-semibold">{current?.label ?? "Account"}</span>
          <ChevronDown className="h-4 w-4 text-slate-500 dark:text-slate-400" />
        </button>
        <div className="flex items-center gap-1">
          <div className="relative">
            <IconButton title="Notifications" onClick={() => navigate("notifications")}>
              <Bell className="h-5 w-5" />
            </IconButton>
            {(unread.data ?? 0) > 0 && (
              <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {unread.data! > 9 ? "9+" : unread.data}
              </span>
            )}
          </div>
          <IconButton
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </IconButton>
          <IconButton title="Settings" onClick={() => navigate("settings")}>
            <SettingsIcon className="h-5 w-5" />
          </IconButton>
        </div>
      </div>

      {/* address pill */}
      <div className="px-3 pt-1">
        <button
          onClick={() => addr && copy(addr)}
          className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-900 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800"
        >
          <span className="font-mono">{shortAddr(addr)}</span>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* balance */}
      <div className="px-4 pt-4">
        <div className="text-3xl font-bold tracking-tight">
          {fmtBalance(balance.data)}{" "}
          <span className="text-xl font-semibold text-slate-400">{symbol}</span>
        </div>
        <div className="mt-0.5 text-xs text-slate-400">
          {current?.kind === "remote"
            ? "STRATO account"
            : current?.kind === "mpc"
              ? "MPC (2-of-2)"
              : "Self-custody"}{" "}
          ·{" "}
          {network.data?.name ?? "STRATO"}
        </div>
      </div>

      {/* actions */}
      <div className="flex gap-2 px-3 pt-4">
        <ActionButton label="Buy" icon={<DollarSign className="h-5 w-5" />} disabled />
        <ActionButton
          label="Swap"
          icon={<ArrowUpDown className="h-5 w-5" />}
          onClick={() => navigate("swap")}
          disabled={!swapEnabled}
        />
        <ActionButton
          label="Send"
          icon={<ArrowLeftRight className="h-5 w-5" />}
          onClick={() => navigate("send")}
        />
        <ActionButton
          label="Receive"
          icon={<ArrowDownLeft className="h-5 w-5" />}
          onClick={() => navigate("receive")}
        />
      </div>

      {/* tabs */}
      <div className="mt-4 flex gap-4 border-b border-slate-200 dark:border-slate-800 px-4">
        {(["tokens", "defi", "activity"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 pb-2 text-sm font-medium capitalize ${
              tab === t
                ? "border-[#001B70] dark:border-blue-400 text-slate-900 dark:text-slate-200"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            {t === "defi" ? "DeFi" : t}
          </button>
        ))}
      </div>

      {/* network selector below tabs */}
      <div className="px-4 pt-3">
        <div className="relative inline-block">
          <select
            value={network.data?.id ?? ""}
            onChange={async (e) => {
              await callBackground("networks.select", e.target.value);
              network.refresh();
              balance.refresh();
            }}
            className="appearance-none rounded-full border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 py-1.5 pl-3 pr-8 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-900"
          >
            {visibleNetworks(networks.data, showTestnets.data, network.data?.id).map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
        </div>
      </div>

      {/* tab content */}
      <div className="px-4 pb-4 pt-3">
        {tab === "tokens" && (
          <TokensTab
            balance={balance.data}
            symbol={symbol}
            address={addr}
            network={network.data}
            navigate={navigate}
          />
        )}
        {tab === "defi" && <DeFiTab address={addr} network={network.data} navigate={navigate} />}
        {tab === "activity" && <ActivityTab address={addr} network={network.data} />}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Tokens
function TokenIcon({
  symbol,
  icon,
  fallback,
  badge,
}: {
  symbol: string;
  icon?: string;
  fallback?: React.ReactNode;
  /** Small network logo (MetaMask-style) overlaid on the bottom-right corner. */
  badge?: string;
}) {
  const [failed, setFailed] = useState(false);
  const base =
    symbol === "USDST" ? (
      <Logo className="h-8 w-8 shrink-0" />
    ) : icon && !failed ? (
      <img
        src={icon}
        alt=""
        onError={() => setFailed(true)}
        className="h-8 w-8 shrink-0 rounded-full bg-slate-100 dark:bg-slate-900 object-cover"
      />
    ) : fallback ? (
      <>{fallback}</>
    ) : (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-900 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
        {symbol.slice(0, 4)}
      </span>
    );
  if (!badge) return base;
  return (
    <span className="relative inline-flex h-8 w-8 shrink-0">
      {base}
      <ChainBadge src={badge} />
    </span>
  );
}

// Network logo badge pinned to the bottom-right of a token icon. Hides itself if
// the image fails to load so a broken icon never shows.
function ChainBadge({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border border-white bg-white object-cover dark:border-slate-900"
    />
  );
}

function TokensTab({
  balance,
  symbol,
  address,
  network,
  navigate,
}: {
  balance?: string;
  symbol: string;
  address: Address | null;
  network?: StratoNetwork;
  navigate: (to: string) => void;
}) {
  const tokens = useAsync<TokenBalance[]>(
    async () => (address && network ? callBackground("tokens.list", address) : []),
    [address, network?.chainId]
  );
  const [showLegacy, setShowLegacy] = useState(false);
  // Token details are STRATO-only (Cirrus-backed).
  const canDetail = !!network && isStratoNetwork(network);
  const openToken = (addr?: string) =>
    canDetail && addr ? () => navigate(`token/${addr}`) : undefined;

  // The native (USDST) balance comes from the headline rpc call; list other
  // tokens from Cirrus below it (deduped against the native symbol). Active
  // tokens (status 2) show in the main list; legacy (status 3) collapse below;
  // anything else is hidden.
  const others = (tokens.data ?? []).filter((t) => t.symbol !== symbol);
  const active = others.filter((t) => t.status === 2);
  const legacy = others.filter((t) => t.status === 3);
  const nativeToken = (tokens.data ?? []).find((t) => t.symbol === symbol);
  const nativeName = nativeToken?.name ?? symbol;
  const badge = network?.chainBadge;

  const nativeClick = openToken(nativeToken?.address);
  return (
    <div className="space-y-1">
      <div
        onClick={nativeClick}
        className={`flex items-center justify-between gap-3 overflow-hidden rounded-lg px-1 py-2 ${
          nativeClick ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900" : ""
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TokenIcon symbol={symbol} icon={nativeToken?.icon} badge={badge} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{symbol}</div>
            <div className="truncate text-xs text-slate-400">{nativeName}</div>
          </div>
        </div>
        <div className="shrink-0 whitespace-nowrap text-right text-sm font-medium">
          {fmtBalance(balance)} {symbol}
        </div>
      </div>

      {active.map((t) => (
        <TokenRow key={t.address} token={t} badge={badge} onClick={openToken(t.address)} />
      ))}

      {legacy.length > 0 && (
        <div className="pt-1">
          <button
            onClick={() => setShowLegacy((v) => !v)}
            className="flex w-full items-center gap-1 px-1 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showLegacy ? "" : "-rotate-90"}`}
            />
            Legacy tokens ({legacy.length})
          </button>
          {showLegacy &&
            legacy.map((t) => (
              <TokenRow key={t.address} token={t} badge={badge} muted onClick={openToken(t.address)} />
            ))}
        </div>
      )}
    </div>
  );
}

function TokenRow({
  token,
  badge,
  muted,
  onClick,
}: {
  token: TokenBalance;
  badge?: string;
  muted?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between gap-3 overflow-hidden rounded-lg px-1 py-2 ${
        muted ? "opacity-70" : ""
      } ${onClick ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900" : ""}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <TokenIcon symbol={token.symbol} icon={token.icon} badge={badge} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{token.symbol}</div>
          <div className="truncate text-xs text-slate-400">{token.name}</div>
        </div>
      </div>
      <div className="shrink-0 whitespace-nowrap text-right text-sm font-medium">
        {token.amount} {token.symbol}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- DeFi
function DeFiTab({
  address,
  network,
  navigate,
}: {
  address: Address | null;
  network?: StratoNetwork;
  navigate: (to: string) => void;
}) {
  const positions = useAsync<DefiPosition[]>(
    async () => (address && network ? callBackground("defi.list", address) : []),
    [address, network?.chainId]
  );
  const list = positions.data ?? [];

  if (positions.loading) {
    return <div className="py-10 text-center text-sm text-slate-400">Loading…</div>;
  }

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Coins className="h-10 w-10 text-slate-300" />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No vault or liquidity-pool positions yet.
        </p>
        <Button className="!w-auto px-6" onClick={() => openTab(STRATO_DEFI_URL)}>
          Explore DeFi
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {list.map((p, i) => (
        <div
          key={p.symbol + i}
          onClick={p.address ? () => navigate(`token/${p.address}`) : undefined}
          className={`flex items-center justify-between gap-3 overflow-hidden rounded-lg px-1 py-2 ${
            p.address ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900" : ""
          }`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TokenIcon
              symbol={p.symbol}
              icon={p.icon}
              fallback={
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950 text-[#001B70] dark:text-blue-300">
                  <Coins className="h-4 w-4" />
                </span>
              }
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{p.label}</div>
              <div className="truncate text-xs text-slate-400">{p.sub}</div>
            </div>
          </div>
          <div className="shrink-0 whitespace-nowrap text-right text-sm font-medium">
            {p.amount} {p.symbol}
          </div>
        </div>
      ))}
      <button
        onClick={() => openTab(STRATO_DEFI_URL)}
        className="mt-2 w-full rounded-lg py-2 text-center text-sm font-medium text-[#001B70] dark:text-blue-300 hover:bg-slate-50 dark:hover:bg-slate-900"
      >
        Explore DeFi
      </button>
    </div>
  );
}

// --------------------------------------------------------------- Activity
function ActivityTab({
  address,
  network,
}: {
  address: Address | null;
  network?: StratoNetwork;
}) {
  const items = useAsync<ActivityItem[]>(
    async () => (address && network ? callBackground("activity.list", address, 25) : []),
    [address, network?.chainId]
  );

  if (items.loading) {
    return <div className="py-10 text-center text-sm text-slate-400">Loading…</div>;
  }
  if (items.error) {
    return (
      <div className="py-10 text-center text-xs text-slate-400">
        Couldn’t load activity from the node.
      </div>
    );
  }
  const list = items.data ?? [];
  if (list.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-400">No activity yet.</div>;
  }

  return (
    <div className="space-y-1">
      {list.map((t, i) => {
        const url = network ? explorerTxUrl(network, t.hash) : "";
        const incoming = t.direction === "in";
        return (
          <a
            key={t.hash + i}
            href={url || undefined}
            onClick={(e) => {
              if (!url) return;
              e.preventDefault();
              openTab(url);
            }}
            className="flex items-center justify-between rounded-lg px-1 py-2 hover:bg-slate-50 dark:hover:bg-slate-900"
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  incoming ? "bg-green-50 text-green-600 dark:text-green-400" : "bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400"
                }`}
              >
                {incoming ? (
                  <ArrowDownLeft className="h-4 w-4" />
                ) : (
                  <ArrowUpRight className="h-4 w-4" />
                )}
              </span>
              <div>
                <div className="text-sm font-medium">
                  {incoming ? "Received" : "Sent"} {t.symbol}
                </div>
                <div className="font-mono text-xs text-slate-400">
                  {incoming ? "From" : "To"} {shortAddr(t.counterparty)}
                </div>
              </div>
            </div>
            <div className="text-right text-sm">
              <div className={`font-medium ${incoming ? "text-green-600 dark:text-green-400" : ""}`}>
                {incoming ? "+" : "-"}
                {t.amount} {t.symbol}
              </div>
              <div className="text-xs text-slate-400">
                {new Date(t.timestamp).toLocaleDateString()}
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------------- Send
export function Send({ navigate }: { navigate: (to: string) => void }) {
  const selected = useAsync<Address | null>(() => callBackground("accounts.selected"));
  const network = useAsync<StratoNetwork>(() => callBackground("networks.selected"));
  const allNetworks = useAsync<StratoNetwork[]>(() => callBackground("networks.list"));
  const tokens = useAsync<TokenBalance[]>(
    async () => (selected.data ? callBackground("tokens.list", selected.data) : []),
    [selected.data, network.data?.chainId]
  );
  const bridge = useAsync<BridgeConfig>(() => callBackground("bridge.config"));

  const [tokenAddr, setTokenAddr] = useState<string | null>(null);
  const [destId, setDestId] = useState<string | null>(null); // null = same chain (transfer)
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sourceIsStrato = network.data ? isStratoNetwork(network.data) : true;
  const list = (tokens.data ?? []).filter((t) => t.status === 2);

  // Default token: USDST (native) if held, else the first.
  useEffect(() => {
    if (tokenAddr || list.length === 0) return;
    setTokenAddr((list.find((t) => t.symbol === "USDST") ?? list[0]).address);
  }, [list, tokenAddr]);

  const token = list.find((t) => t.address === tokenAddr);
  const tokenKey = token ? token.address.replace(/^0x/, "").toLowerCase() : "";
  const routes = bridge.data?.routes ?? [];

  // Destination options: same chain (transfer) + any configured bridge routes.
  const destOptions = useMemo(() => {
    const opts: { id: string; label: string; route?: BridgeRoute }[] = [];
    if (network.data) opts.push({ id: network.data.id, label: `${network.data.name} (transfer)` });
    if (!token) return opts;
    if (sourceIsStrato) {
      for (const r of routes) {
        if (r.stratoToken !== tokenKey) continue;
        const net = (allNetworks.data ?? []).find(
          (n) => !isStratoNetwork(n) && n.chainId === r.externalChainId
        );
        if (net) opts.push({ id: net.id, label: `Bridge to ${net.name}`, route: r });
      }
    } else if (network.data) {
      const r = routes.find(
        (x) => x.externalChainId === network.data!.chainId && x.externalToken === tokenKey
      );
      const strato = (allNetworks.data ?? []).find(isStratoNetwork);
      if (r && strato) opts.push({ id: strato.id, label: "Bridge to STRATO", route: r });
    }
    return opts;
  }, [network.data, allNetworks.data, routes, token, tokenKey, sourceIsStrato]);

  const dest = destOptions.find((o) => o.id === destId) ?? destOptions[0];
  const isBridge = !!dest?.route;
  const canBridge = destOptions.some((o) => !!o.route);

  const balanceRaw = token ? BigInt(token.raw) : 0n;
  const amountRaw = token ? safeParseUnits(amount, token.decimals) : 0n;
  const insufficient = amountRaw > balanceRaw;

  const setPct = (pct: number) => {
    if (!token) return;
    const raw = pct === 100 ? balanceRaw : (balanceRaw * BigInt(pct)) / 100n;
    setAmount(formatUnits(raw, token.decimals));
  };

  const submit = async () => {
    if (!token) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      if (isBridge && dest?.route) {
        if (sourceIsStrato) {
          await callBackground("bridge.withdraw", selected.data, bridge.data, dest.route, amountRaw.toString(), to.trim());
        } else {
          const router = bridge.data!.chains.find(
            (c) => c.chainId === network.data!.chainId
          )?.depositRouter;
          if (!router) throw new Error("No deposit router for this chain");
          await callBackground("bridge.deposit", selected.data, dest.route, router, amountRaw.toString(), to.trim());
        }
        setStatus(`Bridging ${amount} ${token.symbol} → ${dest.label.replace("Bridge to ", "")}. It may take a few minutes to arrive.`);
      } else {
        await callBackground("tx.sendToken", selected.data, token.address, to.trim(), amountRaw.toString());
        setStatus(`Sent ${amount} ${token.symbol} to ${shortAddr(to.trim())}`);
      }
      setAmount("");
      tokens.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ScreenHeader title={isBridge ? "Bridge" : "Send"} onClose={() => navigate("")} />
      <div className="space-y-3 p-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          From {shortAddr(selected.data)} on {network.data?.name ?? "—"}
        </p>

        <Field label="Token">
          <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-2 py-1.5">
            {token && (
              <TokenIcon symbol={token.symbol} icon={token.icon} badge={network.data?.chainBadge} />
            )}
            <select
              value={tokenAddr ?? ""}
              onChange={(e) => {
                setTokenAddr(e.target.value);
                setAmount("");
                setDestId(null);
              }}
              className="flex-1 bg-transparent text-sm font-medium outline-none"
            >
              {list.map((t) => (
                <option key={t.address} value={t.address}>
                  {t.symbol} — {t.amount}
                </option>
              ))}
            </select>
          </div>
        </Field>

        <Field label={isBridge ? `Recipient on ${dest?.label.replace("Bridge to ", "")}` : "To address"}>
          <div className="flex gap-1.5">
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" />
            {canBridge && (
              <button
                onClick={() => selected.data && setTo(selected.data)}
                className="shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800 px-2 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                Me
              </button>
            )}
          </div>
        </Field>

        {/* Destination network: same chain = transfer; other = bridge. Only shown
            when the selected token actually has a bridge route. */}
        {canBridge && (
          <Field label="Destination network">
            <select
              value={dest?.id ?? ""}
              onChange={(e) => setDestId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {destOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div>
          <Field label={`Amount${token ? ` (${token.symbol})` : ""}`}>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
          </Field>
          <div className="mt-1.5 flex gap-1.5">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                onClick={() => setPct(p)}
                disabled={!token}
                className="flex-1 rounded-md bg-slate-100 dark:bg-slate-800 py-1 text-xs font-medium hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40"
              >
                {p === 100 ? "Max" : `${p}%`}
              </button>
            ))}
          </div>
        </div>

        {isBridge && (
          <p className="rounded-md bg-blue-50 dark:bg-blue-950 p-2 text-xs text-[#001B70] dark:text-blue-300">
            Cross-chain bridge. Funds are released on the destination chain by a relayer after
            confirmation.
          </p>
        )}
        <ErrorText>{error}</ErrorText>
        {insufficient && amountRaw > 0n && (
          <p className="text-xs text-red-600 dark:text-red-400">Insufficient balance.</p>
        )}
        {status && (
          <p className="break-all text-xs text-green-700 dark:text-green-400">{status}</p>
        )}
        <Button
          disabled={busy || !token || amountRaw <= 0n || insufficient || !to.trim()}
          onClick={submit}
        >
          {busy ? (isBridge ? "Bridging…" : "Sending…") : isBridge ? "Bridge" : "Send"}
        </Button>

        <button
          onClick={() => navigate("bridges")}
          className="w-full pt-1 text-center text-xs text-[#001B70] dark:text-blue-300 hover:underline"
        >
          View bridge transfers
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- Bridge history
const BRIDGE_CHAIN_NAMES: Record<string, string> = {
  "1": "Ethereum",
  "8453": "Base",
  "59144": "Linea",
};
function bridgeChainName(id: string): string {
  return BRIDGE_CHAIN_NAMES[id] ?? `Chain ${id}`;
}

export function BridgeHistory({ navigate }: { navigate: (to: string) => void }) {
  const selected = useAsync<Address | null>(() => callBackground("accounts.selected"));
  const items = useAsync<BridgeHistoryItem[]>(
    async () => (selected.data ? callBackground("bridge.history", selected.data) : []),
    [selected.data]
  );
  const list = items.data ?? [];

  return (
    <div>
      <ScreenHeader title="Bridge transfers" onClose={() => navigate("")} />
      <div className="space-y-1 p-3">
        {items.loading && (
          <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
        )}
        {!items.loading && list.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-400">No bridge transfers yet.</div>
        )}
        {list.map((b, i) => {
          const out = b.direction === "out";
          const chain = bridgeChainName(b.externalChainId);
          const statusColor =
            b.status === "completed"
              ? "text-green-600 dark:text-green-400"
              : b.status === "failed"
                ? "text-red-600 dark:text-red-400"
                : "text-amber-600";
          return (
            <div
              key={b.timestamp + i}
              className="flex items-center justify-between gap-3 overflow-hidden rounded-lg px-1 py-2"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950 text-[#001B70] dark:text-blue-300">
                  {out ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {out ? `Bridge to ${chain}` : `Bridge from ${chain}`}
                  </div>
                  <div className={`text-xs capitalize ${statusColor}`}>{b.status}</div>
                </div>
              </div>
              <div className="shrink-0 whitespace-nowrap text-right text-sm">
                <div className="font-medium">
                  {b.amount} {b.symbol}
                </div>
                <div className="text-xs text-slate-400">
                  {new Date(b.timestamp).toLocaleDateString()}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Notifications
interface WalletNotification {
  id: string;
  type: "bridge" | "incoming" | "loan";
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  route?: string;
}

function notifIcon(type: WalletNotification["type"]) {
  if (type === "bridge") return <ArrowLeftRight className="h-4 w-4" />;
  if (type === "incoming") return <ArrowDownLeft className="h-4 w-4" />;
  return <ShieldAlert className="h-4 w-4" />;
}

export function Notifications({ navigate }: { navigate: (to: string) => void }) {
  const items = useAsync<WalletNotification[]>(() => callBackground("notifications.list"));
  const list = items.data ?? [];

  // Opening the center clears the unread badge; the loaded list keeps its
  // read flags so just-read items still render highlighted this once.
  useEffect(() => {
    callBackground("notifications.markAllRead").catch(() => {});
  }, []);

  const clearAll = async () => {
    await callBackground("notifications.clear");
    items.refresh();
  };

  return (
    <div>
      <ScreenHeader title="Notifications" onClose={() => navigate("")} />
      <div className="p-3">
        {list.length > 0 && (
          <div className="mb-1 flex justify-end">
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear all
            </button>
          </div>
        )}
        <div className="space-y-1">
          {items.loading && (
            <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
          )}
          {!items.loading && list.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Bell className="h-10 w-10 text-slate-300" />
              <p className="text-sm text-slate-500 dark:text-slate-400">No notifications yet.</p>
            </div>
          )}
          {list.map((n) => (
            <button
              key={n.id}
              onClick={() => navigate(n.route ?? "")}
              className={`flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-900 ${
                n.read ? "" : "bg-blue-50/60 dark:bg-blue-950/40"
              }`}
            >
              <span
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  n.type === "loan"
                    ? "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
                    : "bg-blue-50 text-[#001B70] dark:bg-blue-950 dark:text-blue-300"
                }`}
              >
                {notifIcon(n.type)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{n.title}</span>
                  {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{n.body}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- Token details
interface TokenDetail {
  address: string;
  symbol: string;
  name: string;
  icon?: string;
  decimals: number;
  description?: string;
  status: number;
  priceUsd?: number;
  balanceAmount: string;
  balanceUsd?: number;
  marketCapUsd?: number;
  circulatingSupply?: number;
}
interface PricePoint {
  t: number;
  price: number;
}

const RANGES: { id: string; label: string; secs: number }[] = [
  { id: "1D", label: "1D", secs: 86400 },
  { id: "1W", label: "1W", secs: 7 * 86400 },
  { id: "1M", label: "1M", secs: 30 * 86400 },
  { id: "3M", label: "3M", secs: 90 * 86400 },
  { id: "1Y", label: "1Y", secs: 365 * 86400 },
  { id: "All", label: "All", secs: 0 },
];

function fmtUsd(n: number | undefined, opts?: { compact?: boolean }): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    notation: opts?.compact ? "compact" : "standard",
    maximumFractionDigits: opts?.compact ? 2 : n < 1 ? 6 : 2,
  });
}
function fmtCount(n: number | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 });
}

function PriceChart({ points }: { points: PricePoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-slate-400">
        Not enough price history
      </div>
    );
  }
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const W = 320;
  const H = 130;
  const pad = 6;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (pr: number) => pad + (1 - (pr - min) / range) * (H - 2 * pad);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const area = `${line} L${W.toFixed(1)},${H} L0,${H} Z`;
  const up = prices[prices.length - 1] >= prices[0];
  const stroke = up ? "#16a34a" : "#dc2626";

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full">
        <defs>
          <linearGradient id="pcfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#pcfill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="pointer-events-none absolute right-1 top-0 text-[11px] text-slate-400">
        {fmtUsd(max)}
      </span>
      <span className="pointer-events-none absolute bottom-0 right-1 text-[11px] text-slate-400">
        {fmtUsd(min)}
      </span>
    </div>
  );
}

export function TokenDetails({ address, navigate }: { address: string; navigate: (to: string) => void }) {
  const selected = useAsync<Address | null>(() => callBackground("accounts.selected"));
  const detail = useAsync<TokenDetail | null>(
    async () => (selected.data ? callBackground("token.detail", address, selected.data) : null),
    [address, selected.data]
  );
  const [range, setRange] = useState("1D");
  const history = useAsync<PricePoint[]>(
    async () => {
      const r = RANGES.find((x) => x.id === range)!;
      const since = r.secs ? Math.floor(Date.now() / 1000) - r.secs : 0;
      return callBackground("token.priceHistory", address, since, 40);
    },
    [address, range]
  );
  const activity = useAsync<ActivityItem[]>(
    async () => (selected.data ? callBackground("token.activity", address, selected.data) : []),
    [address, selected.data]
  );

  const d = detail.data;
  const pts = history.data ?? [];
  const change =
    pts.length >= 2 && pts[0].price > 0 ? (pts[pts.length - 1].price - pts[0].price) / pts[0].price : null;
  const asOf = pts.length ? new Date(pts[pts.length - 1].t * 1000) : null;

  return (
    <div>
      <ScreenHeader title={d?.symbol ?? "Token"} onClose={() => navigate("")} />
      <div className="space-y-4 p-4">
        {detail.loading && <div className="py-10 text-center text-sm text-slate-400">Loading…</div>}

        {d && (
          <>
            {/* price header */}
            {d.priceUsd != null && (
              <div>
                <div className="text-xs text-slate-400">{d.symbol}</div>
                <div className="text-3xl font-bold tracking-tight">{fmtUsd(d.priceUsd)}</div>
                <div className="mt-0.5 flex items-center gap-2 text-sm">
                  {change != null && (
                    <span className={change >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                      {change >= 0 ? "+" : ""}
                      {(change * 100).toFixed(2)}%
                    </span>
                  )}
                  {asOf && <span className="text-slate-400">{asOf.toLocaleString()}</span>}
                </div>
              </div>
            )}

            {/* chart + range tabs (only when priced) */}
            {d.priceUsd != null && (
              <div>
                {history.loading ? (
                  <div className="h-40 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-900" />
                ) : (
                  <PriceChart points={pts} />
                )}
                <div className="mt-2 flex justify-between">
                  {RANGES.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRange(r.id)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        range === r.id
                          ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                          : "text-slate-400 hover:text-slate-600"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* actions */}
            <div className="flex gap-2">
              <ActionButton label="Buy" icon={<DollarSign className="h-5 w-5" />} disabled />
              <ActionButton label="Swap" icon={<ArrowUpDown className="h-5 w-5" />} onClick={() => navigate("swap")} />
              <ActionButton label="Send" icon={<ArrowLeftRight className="h-5 w-5" />} onClick={() => navigate("send")} />
              <ActionButton label="Receive" icon={<ArrowDownLeft className="h-5 w-5" />} onClick={() => navigate("receive")} />
            </div>

            {/* your balance */}
            <div>
              <p className="mb-1 text-sm font-semibold">Your balance</p>
              <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <TokenIcon symbol={d.symbol} icon={d.icon} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{d.name}</div>
                    <div className="truncate text-xs text-slate-400">{d.symbol}</div>
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm">
                  {d.balanceUsd != null && <div className="font-medium">{fmtUsd(d.balanceUsd)}</div>}
                  <div className="text-xs text-slate-400">
                    {d.balanceAmount} {d.symbol}
                  </div>
                </div>
              </div>
            </div>

            {/* token details */}
            <div>
              <p className="mb-1 text-sm font-semibold">Token details</p>
              <div className="space-y-1.5 text-sm">
                <DetailRow label="Network" value="STRATO" />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Contract</span>
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    {shortAddr(d.address)}
                    <CopyButton value={d.address} className="text-slate-400 hover:text-slate-600" />
                  </span>
                </div>
                <DetailRow label="Decimals" value={String(d.decimals)} />
              </div>
              {d.description && (
                <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {d.description}
                </p>
              )}
            </div>

            {/* market details */}
            {(d.marketCapUsd != null || d.circulatingSupply != null) && (
              <div>
                <p className="mb-1 text-sm font-semibold">Market details</p>
                <div className="space-y-1.5 text-sm">
                  {d.marketCapUsd != null && (
                    <DetailRow label="Market cap" value={fmtUsd(d.marketCapUsd, { compact: true })} />
                  )}
                  {d.circulatingSupply != null && (
                    <DetailRow label="Circulating supply" value={`${fmtCount(d.circulatingSupply)} ${d.symbol}`} />
                  )}
                </div>
              </div>
            )}

            {/* your activity */}
            <div>
              <p className="mb-1 text-sm font-semibold">Your activity</p>
              {(activity.data ?? []).length === 0 ? (
                <p className="py-3 text-center text-xs text-slate-400">No activity yet.</p>
              ) : (
                <div className="space-y-1">
                  {(activity.data ?? []).map((a, i) => {
                    const incoming = a.direction === "in";
                    return (
                      <div key={a.hash + i} className="flex items-center justify-between gap-3 px-1 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-900 text-slate-500">
                            {incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {incoming ? "Received" : a.direction === "self" ? "Self transfer" : "Sent"}
                            </div>
                            <div className="text-xs text-slate-400">
                              {new Date(a.timestamp).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-sm font-medium">
                          {incoming ? "+" : "-"}
                          {a.amount} {a.symbol}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {!detail.loading && !d && (
          <p className="py-10 text-center text-sm text-slate-400">Token details unavailable.</p>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

// --------------------------------------------------------------------- Swap
function safeParseUnits(amount: string, decimals: number): bigint {
  try {
    return parseUnits((amount || "0").trim() || "0", decimals);
  } catch {
    return 0n;
  }
}

export function SwapScreen({ navigate }: { navigate: (to: string) => void }) {
  const selected = useAsync<Address | null>(() => callBackground("accounts.selected"));
  const pools = useAsync<SwapPool[]>(() => callBackground("swap.pools"));
  const tokensRes = useAsync<TokenBalance[]>(
    async () => (selected.data ? callBackground("tokens.list", selected.data) : []),
    [selected.data]
  );

  const [fromAddr, setFromAddr] = useState<string | null>(null);
  const [toAddr, setToAddr] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const poolList = pools.data ?? [];

  // Token universe + balances keyed by lowercase address (no 0x).
  const universe = useMemo(() => {
    const m: Record<string, SwapToken> = {};
    for (const p of poolList) {
      m[p.tokenA.address] = p.tokenA;
      m[p.tokenB.address] = p.tokenB;
    }
    return m;
  }, [poolList]);

  const balances = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of tokensRes.data ?? []) {
      m[t.address.replace(/^0x/, "").toLowerCase()] = t.raw;
    }
    return m;
  }, [tokensRes.data]);

  // Tokens that can be paired with the current `from` token.
  const pairable = useMemo(() => {
    if (!fromAddr) return [] as string[];
    const set = new Set<string>();
    for (const p of poolList) {
      if (p.tokenA.address === fromAddr) set.add(p.tokenB.address);
      if (p.tokenB.address === fromAddr) set.add(p.tokenA.address);
    }
    return [...set];
  }, [poolList, fromAddr]);

  // Pick sensible defaults once pools load.
  useEffect(() => {
    if (fromAddr || poolList.length === 0) return;
    const addrs = Object.keys(universe);
    const usdst = addrs.find((a) => universe[a].symbol === "USDST");
    const from = usdst ?? addrs[0];
    setFromAddr(from);
    const firstPair = poolList.find(
      (p) => p.tokenA.address === from || p.tokenB.address === from
    );
    if (firstPair) {
      setToAddr(firstPair.tokenA.address === from ? firstPair.tokenB.address : firstPair.tokenA.address);
    }
  }, [poolList, universe, fromAddr]);

  const fromToken = fromAddr ? universe[fromAddr] : undefined;
  const toToken = toAddr ? universe[toAddr] : undefined;
  const route = fromAddr && toAddr ? findPool(poolList, fromAddr, toAddr) : null;

  const amountInRaw = fromToken ? safeParseUnits(amount, fromToken.decimals) : 0n;
  const outRaw = route && amountInRaw > 0n ? quoteOut(route.pool, amountInRaw, route.isAToB) : 0n;
  const minOutRaw = outRaw - (outRaw * BigInt(Math.round(slippage * 100))) / 10000n;
  const fromBalRaw = fromAddr ? BigInt(balances[fromAddr] ?? "0") : 0n;
  const insufficient = amountInRaw > fromBalRaw;
  const outDisplay =
    toToken && outRaw > 0n
      ? Number(formatUnits(outRaw, toToken.decimals)).toLocaleString(undefined, {
          maximumFractionDigits: 6,
        })
      : "0";

  const flip = () => {
    if (!toAddr) return;
    setFromAddr(toAddr);
    setToAddr(fromAddr);
    setAmount("");
    setStatus(null);
  };

  const doSwap = async () => {
    if (!route || !fromToken || amountInRaw <= 0n) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await callBackground("swap.execute", selected.data, {
        poolAddress: route.pool.address,
        isAToB: route.isAToB,
        inputTokenAddress: fromToken.address,
        amountIn: amountInRaw.toString(),
        minAmountOut: minOutRaw.toString(),
      });
      setStatus(`Swapped ${amount} ${fromToken.symbol} → ~${outDisplay} ${toToken?.symbol}`);
      setAmount("");
      tokensRes.refresh();
      pools.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tokenSelect = (
    value: string | null,
    onChange: (a: string) => void,
    options: string[]
  ) => (
    <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-2 py-1.5">
      {value && universe[value] && (
        <TokenIcon symbol={universe[value].symbol} icon={universe[value].icon} />
      )}
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent text-sm font-medium outline-none"
      >
        {options.map((a) => (
          <option key={a} value={a}>
            {universe[a]?.symbol ?? "?"}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div>
      <ScreenHeader title="Swap" onClose={() => navigate("")} />
      <div className="space-y-3 p-4">
        {/* From */}
        <Card className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>From</span>
            {fromToken && (
              <button
                className="hover:underline"
                onClick={() =>
                  fromToken && setAmount(formatUnits(fromBalRaw, fromToken.decimals))
                }
              >
                Balance:{" "}
                {fromToken
                  ? Number(formatUnits(fromBalRaw, fromToken.decimals)).toLocaleString(undefined, {
                      maximumFractionDigits: 4,
                    })
                  : "0"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="w-32">{tokenSelect(fromAddr, setFromAddr, Object.keys(universe))}</div>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              inputMode="decimal"
              className="min-w-0 flex-1 bg-transparent text-right text-lg font-semibold outline-none"
            />
          </div>
        </Card>

        {/* Flip */}
        <div className="flex justify-center">
          <button
            onClick={flip}
            aria-label="Flip"
            className="-my-2 flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowUpDown className="h-4 w-4" />
          </button>
        </div>

        {/* To */}
        <Card className="space-y-2">
          <div className="text-xs text-slate-500">To (estimated)</div>
          <div className="flex items-center gap-2">
            <div className="w-32">{tokenSelect(toAddr, setToAddr, pairable)}</div>
            <div className="min-w-0 flex-1 truncate text-right text-lg font-semibold">
              {outDisplay}
            </div>
          </div>
        </Card>

        {/* Rate + slippage */}
        <div className="space-y-1 px-1 text-xs text-slate-500">
          {route && fromToken && toToken && outRaw > 0n && (
            <div className="flex justify-between">
              <span>Rate</span>
              <span>
                1 {fromToken.symbol} ≈{" "}
                {(
                  Number(formatUnits(outRaw, toToken.decimals)) /
                  Math.max(Number(formatUnits(amountInRaw, fromToken.decimals)), 1e-9)
                ).toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
                {toToken.symbol}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span>Slippage</span>
            <div className="flex gap-1">
              {[0.5, 1, 3].map((s) => (
                <button
                  key={s}
                  onClick={() => setSlippage(s)}
                  className={`rounded px-1.5 py-0.5 ${
                    slippage === s
                      ? "bg-[#001B70] text-white"
                      : "bg-slate-100 dark:bg-slate-800"
                  }`}
                >
                  {s}%
                </button>
              ))}
            </div>
          </div>
        </div>

        {!route && fromAddr && toAddr && (
          <p className="text-xs text-amber-600">No pool for this pair.</p>
        )}
        <ErrorText>{error}</ErrorText>
        {insufficient && amountInRaw > 0n && (
          <p className="text-xs text-red-600 dark:text-red-400">Insufficient balance.</p>
        )}
        {status && <p className="break-all text-xs text-green-700 dark:text-green-400">{status}</p>}

        <Button
          disabled={busy || !route || amountInRaw <= 0n || insufficient || outRaw <= 0n}
          onClick={doSwap}
        >
          {busy ? "Swapping…" : "Swap"}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Receive
export function Receive({ navigate }: { navigate: (to: string) => void }) {
  const selected = useAsync<Address | null>(() => callBackground("accounts.selected"));
  const networks = useAsync<StratoNetwork[]>(() => callBackground("networks.list"));
  const [qrFor, setQrFor] = useState<StratoNetwork | null>(null);
  const addr = selected.data ?? "";

  return (
    <div>
      <ScreenHeader title="Receive" onClose={() => navigate("")} />
      <div className="space-y-1 p-3">
        <p className="px-1 pb-2 text-xs text-slate-500 dark:text-slate-400">
          Share your address to receive tokens on a STRATO network.
        </p>
        {(networks.data ?? []).map((n) => (
          <div
            key={n.id}
            className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <Avatar address={addr + n.id} size={28} />
              <div>
                <div className="text-sm font-medium">{n.name}</div>
                <div className="font-mono text-xs text-slate-400">{shortAddr(addr)}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <CopyButton value={addr} className="text-slate-500 dark:text-slate-400 hover:text-slate-700" />
              <button
                aria-label="Show QR code"
                onClick={() => setQrFor(n)}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-700"
              >
                <QrCodeIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {qrFor && <QrModal address={addr} network={qrFor} onClose={() => setQrFor(null)} />}
    </div>
  );
}

function QrModal({
  address,
  network,
  onClose,
}: {
  address: string;
  network: StratoNetwork;
  onClose: () => void;
}) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(address, { width: 220, margin: 1 }).then(setSrc).catch(() => setSrc(""));
  }, [address]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{network.name}</span>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 dark:text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 flex flex-col items-center gap-3">
          {src ? (
            <img src={src} alt="address QR" className="h-48 w-48 rounded-lg" />
          ) : (
            <div className="h-48 w-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-900" />
          )}
          <p className="break-all text-center font-mono text-xs text-slate-600 dark:text-slate-300">{address}</p>
          <div className="flex items-center gap-1 text-sm text-[#001B70] dark:text-blue-300">
            <CopyButton value={address} className="text-[#001B70] dark:text-blue-300" />
            <span>Copy address</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------ Reveal secret modal
type RevealTarget =
  | { kind: "mnemonic"; walletId: string; walletLabel: string }
  | { kind: "privatekey"; address: Address; label: string };

function RevealSecret({ target, onClose }: { target: RevealTarget; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, copy] = useCopy();
  const isMnemonic = target.kind === "mnemonic";
  const heading = isMnemonic
    ? `Recovery phrase · ${target.walletLabel}`
    : `Private key · ${target.label}`;

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      const s =
        target.kind === "mnemonic"
          ? await callBackground<string>("wallet.revealMnemonic", password, target.walletId)
          : await callBackground<string>(
              "wallet.exportPrivateKey",
              target.address,
              password
            );
      setSecret(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5">
      <div className="w-full rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{heading}</span>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 dark:text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950 p-2.5 text-xs text-red-700 dark:text-red-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Never share this. Anyone with {isMnemonic ? "your phrase" : "this key"} can take your
            funds.
          </span>
        </div>

        {!secret ? (
          <div className="mt-3 space-y-3">
            <Field label="Confirm password">
              <Input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && reveal()}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
            <Button disabled={busy || !password} onClick={reveal}>
              {busy ? "Verifying…" : "Reveal"}
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {isMnemonic ? (
              <div className="grid grid-cols-3 gap-2 text-sm">
                {secret.split(" ").map((w, i) => (
                  <span key={i} className="rounded bg-slate-50 dark:bg-slate-900 px-2 py-1 text-center">
                    <span className="text-slate-400">{i + 1}.</span> {w}
                  </span>
                ))}
              </div>
            ) : (
              <div className="break-all rounded-lg bg-slate-50 dark:bg-slate-900 p-3 font-mono text-xs">{secret}</div>
            )}
            <button
              onClick={() => copy(secret)}
              className="flex items-center justify-center gap-1.5 text-sm text-[#001B70] dark:text-blue-300"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy to clipboard"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Accounts
function AccountRow({
  account,
  active,
  onSelect,
  onExport,
  onRename,
  onRemove,
}: {
  account: AccountMeta;
  active: boolean;
  onSelect: () => void;
  onExport?: () => void;
  onRename?: (label: string) => void;
  onRemove?: () => void;
}) {
  const isRemote = account.kind === "remote";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(account.label);

  const save = () => {
    const v = value.trim();
    if (v && v !== account.label) onRename?.(v);
    setEditing(false);
  };

  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${
        active ? "border-[#001B70] dark:border-blue-400 bg-blue-50 dark:bg-blue-950" : "border-slate-200 dark:border-slate-800"
      }`}
    >
      {editing ? (
        <div className="flex flex-1 items-center gap-2">
          <Avatar address={account.address} size={32} />
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-800 px-2 py-1 text-sm outline-none focus:border-[#001B70]"
          />
          <button
            onClick={save}
            aria-label="Save name"
            className="flex h-7 w-7 items-center justify-center rounded-full text-[#001B70] dark:text-blue-300 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            onClick={() => setEditing(false)}
            aria-label="Cancel"
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <button onClick={onSelect} className="flex flex-1 items-center gap-2 text-left">
            <Avatar address={account.address} size={32} />
            <div>
              <div className="text-sm font-medium">{account.label}</div>
              <div className="font-mono text-xs text-slate-400">{shortAddr(account.address)}</div>
            </div>
          </button>
          <div className="flex items-center gap-1.5">
            {active && <Check className="h-4 w-4 text-[#001B70] dark:text-blue-300" />}
            {onRename && (
              <button
                title="Rename account"
                aria-label="Rename account"
                onClick={() => {
                  setValue(account.label);
                  setEditing(true);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {onExport && (
              <button
                title="Export private key"
                aria-label="Export private key"
                onClick={onExport}
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800"
              >
                <KeyRound className="h-4 w-4" />
              </button>
            )}
            {onRemove && (
              <button
                title={isRemote ? "Log out of this account" : "Remove account"}
                aria-label={isRemote ? "Log out of this account" : "Remove account"}
                onClick={onRemove}
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
              >
                {isRemote ? <LogOut className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function AccountsList({ navigate }: { navigate: (to: string) => void }) {
  const accounts = useAsync<AccountMeta[]>(() => callBackground("accounts.list"));
  const selected = useAsync<Address | null>(() => callBackground("accounts.selected"));
  const wallets = useAsync<HdWalletInfo[]>(() => callBackground("wallets.list"));
  const [reveal, setReveal] = useState<RevealTarget | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<AccountMeta | null>(null);
  const [busy, setBusy] = useState(false);

  const list = accounts.data ?? [];
  const sel = (selected.data ?? "").toLowerCase();
  const isActive = (a: AccountMeta) => a.address.toLowerCase() === sel;
  const select = async (a: AccountMeta) => {
    await callBackground("accounts.select", a.address);
    navigate("");
  };
  const refresh = () => {
    accounts.refresh();
    wallets.refresh();
  };
  const rename = async (a: AccountMeta, label: string) => {
    await callBackground("accounts.rename", a.address, label);
    accounts.refresh();
  };
  const remove = async (a: AccountMeta) => {
    setBusy(true);
    try {
      await callBackground("accounts.remove", a.address);
      setConfirmRemove(null);
      accounts.refresh();
      selected.refresh();
    } finally {
      setBusy(false);
    }
  };

  const imported = list.filter((a) => a.kind === "imported");
  const remote = list.filter((a) => a.kind === "remote");
  const mpc = list.filter((a) => a.kind === "mpc");

  return (
    <div>
      <ScreenHeader title="Accounts" onClose={() => navigate("")} />
      <div className="space-y-4 p-3">
        {/* HD wallet groups */}
        {(wallets.data ?? []).map((w) => {
          const groupAccounts = list.filter((a) => a.kind === "hd" && a.hdWalletId === w.id);
          return (
            <div key={w.id} className="space-y-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{w.label}</span>
                <div className="flex items-center gap-1">
                  <button
                    title="Add account"
                    aria-label="Add account from this wallet"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await callBackground("accounts.addHd", w.id);
                        refresh();
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    title="Back up recovery phrase"
                    aria-label="Back up recovery phrase"
                    onClick={() =>
                      setReveal({ kind: "mnemonic", walletId: w.id, walletLabel: w.label })
                    }
                    className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800"
                  >
                    <ShieldAlert className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {groupAccounts.map((a) => (
                <AccountRow
                  key={a.address}
                  account={a}
                  active={isActive(a)}
                  onSelect={() => select(a)}
                  onRename={(label) => rename(a, label)}
                  onExport={() =>
                    setReveal({ kind: "privatekey", address: a.address, label: a.label })
                  }
                />
              ))}
            </div>
          );
        })}

        {/* Imported single keys */}
        {imported.length > 0 && (
          <div className="space-y-1">
            <span className="px-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Imported</span>
            {imported.map((a) => (
              <AccountRow
                key={a.address}
                account={a}
                active={isActive(a)}
                onSelect={() => select(a)}
                onRename={(label) => rename(a, label)}
                onExport={() =>
                  setReveal({ kind: "privatekey", address: a.address, label: a.label })
                }
                onRemove={() => setConfirmRemove(a)}
              />
            ))}
          </div>
        )}

        {/* STRATO (OAuth / vault) accounts */}
        {remote.length > 0 && (
          <div className="space-y-1">
            <span className="px-1 text-xs font-semibold text-slate-500 dark:text-slate-400">STRATO accounts</span>
            {remote.map((a) => (
              <AccountRow
                key={a.address}
                account={a}
                active={isActive(a)}
                onSelect={() => select(a)}
                onRename={(label) => rename(a, label)}
                onRemove={() => setConfirmRemove(a)}
              />
            ))}
          </div>
        )}

        {/* MPC (2-of-2 with Vault) accounts */}
        {mpc.length > 0 && (
          <div className="space-y-1">
            <span className="px-1 text-xs font-semibold text-slate-500 dark:text-slate-400">MPC accounts</span>
            {mpc.map((a) => (
              <AccountRow
                key={a.address}
                account={a}
                active={isActive(a)}
                onSelect={() => select(a)}
                onRename={(label) => rename(a, label)}
                onRemove={() => setConfirmRemove(a)}
              />
            ))}
          </div>
        )}

        <div className="space-y-2 pt-1">
          <Button variant="secondary" onClick={() => navigate("import")}>
            <span className="inline-flex items-center justify-center gap-1">
              <Plus className="h-4 w-4" /> Add / import account
            </span>
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await callBackground("accounts.createWallet");
                refresh();
              } finally {
                setBusy(false);
              }
            }}
          >
            Create new wallet
          </Button>
        </div>
      </div>
      {reveal && <RevealSecret target={reveal} onClose={() => setReveal(null)} />}
      {confirmRemove && (
        <RemoveAccountModal
          account={confirmRemove}
          busy={busy}
          onConfirm={() => remove(confirmRemove)}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------ Remove / log out confirmation
function RemoveAccountModal({
  account,
  busy,
  onConfirm,
  onClose,
}: {
  account: AccountMeta;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const isRemote = account.kind === "remote";
  const isMpc = account.kind === "mpc";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5">
      <div className="w-full rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">
            {isRemote ? "Log out of account" : "Remove account"}
          </span>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 dark:text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          {isRemote ? (
            <>
              Log out of <span className="font-medium">{account.label}</span>? You can log back in
              anytime with STRATO. Your funds stay safe in the vault.
            </>
          ) : isMpc ? (
            <>
              Remove <span className="font-medium">{account.label}</span>? This deletes this
              device's MPC shard. Because it's a 2-of-2 key, the account{" "}
              <span className="font-medium">cannot be recovered or sign again</span> without this
              shard — only remove it if the account is empty or you've moved the funds.
            </>
          ) : (
            <>
              Remove <span className="font-medium">{account.label}</span> from this wallet? Make sure
              you have its private key backed up — it can't be recovered here otherwise.
            </>
          )}
        </p>
        <p className="mt-2 break-all font-mono text-xs text-slate-400">{account.address}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            {busy ? "…" : isRemote ? "Log out" : "Remove"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Import
export function ImportAccount({ navigate }: { navigate: (to: string) => void }) {
  const [tab, setTab] = useState<"key" | "seed" | "oauth">("key");
  const [key, setKey] = useState("");
  const [seed, setSeed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const network = useAsync<StratoNetwork>(() => callBackground("networks.selected"));
  const oauthReady = !!(network.data?.oauthIssuer && network.data?.oauthClientId);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      navigate("accounts");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ScreenHeader title="Add account" onClose={() => navigate("accounts")} />
      <div className="space-y-3 p-4">
        <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-900 p-1 text-xs">
          {(["key", "seed", "oauth"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-2 py-1.5 ${tab === t ? "bg-white dark:bg-slate-900 shadow" : ""}`}
            >
              {t === "key" ? "Key" : t === "seed" ? "Seed phrase" : "STRATO"}
            </button>
          ))}
        </div>

        {tab === "key" && (
          <div className="space-y-3">
            <Button onClick={() => run(() => callBackground("accounts.addHd"))}>
              Derive next HD account
            </Button>
            <div className="text-center text-xs text-slate-400">or</div>
            <Field label="Private key (0x…)">
              <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="0x…" />
            </Field>
            <Button
              variant="secondary"
              disabled={busy || !key}
              onClick={() => run(() => callBackground("accounts.importPrivateKey", key.trim()))}
            >
              Import private key
            </Button>
          </div>
        )}

        {tab === "seed" && (
          <div className="space-y-3">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Import a 12/24-word recovery phrase as a new wallet. You can derive more accounts
              from it afterward in the Accounts screen.
            </p>
            <Field label="Recovery phrase">
              <textarea
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                rows={3}
                placeholder="word1 word2 word3 …"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm outline-none focus:border-[#001B70] focus:ring-1 focus:ring-[#001B70]"
              />
            </Field>
            <Button
              disabled={busy || seed.trim().split(/\s+/).length < 12}
              onClick={() => run(() => callBackground("accounts.importSeed", seed))}
            >
              Import from seed phrase
            </Button>
          </div>
        )}

        {tab === "oauth" && (
          <div className="space-y-3">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Sign in to <span className="font-medium">{network.data?.name ?? "STRATO"}</span> with
              your STRATO account. The key stays in the node vault (a remote-signer account).
            </p>
            {!oauthReady && (
              <p className="rounded-md bg-amber-50 dark:bg-amber-950 p-2 text-xs text-amber-800 dark:text-amber-300">
                This network has no OAuth issuer/client configured. Set them in Settings first.
              </p>
            )}
            <Button
              disabled={busy || !oauthReady}
              onClick={() => run(() => callBackground("oauth.login"))}
            >
              {busy ? "Opening login…" : "Login with STRATO"}
            </Button>
            <div className="text-center text-xs text-slate-400">or</div>
            <Button
              variant="secondary"
              disabled={busy || !oauthReady}
              onClick={() => run(() => callBackground("mpc.create"))}
            >
              {busy ? "Opening login…" : "Create MPC account (2-of-2)"}
            </Button>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Generates a new key split between this device and the Vault — both shards are
              required to sign, so neither alone can. The device shard isn't derived from your
              seed phrase, so back up this wallet to avoid losing access.
            </p>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Settings
interface NotifSettings {
  os: boolean;
  bridge: boolean;
  incoming: boolean;
  loan: boolean;
}

function ToggleSwitch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? "bg-[#001B70]" : "bg-slate-300 dark:bg-slate-700"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function Settings({ navigate }: { navigate: (to: string) => void }) {
  const networks = useAsync<StratoNetwork[]>(() => callBackground("networks.list"));
  const selected = useAsync<StratoNetwork>(() => callBackground("networks.selected"));
  const showTestnets = useAsync<boolean>(() => callBackground("settings.showTestnets"));
  const notif = useAsync<NotifSettings>(() => callBackground("notifications.settings"));
  const [form, setForm] = useState<Partial<StratoNetwork>>({});

  const toggleTestnets = async () => {
    await callBackground("settings.setShowTestnets", !showTestnets.data);
    showTestnets.refresh();
  };
  const toggleNotif = async (key: keyof NotifSettings) => {
    await callBackground("notifications.setSettings", { [key]: !notif.data?.[key] });
    notif.refresh();
  };

  const save = async () => {
    const base = selected.data!;
    await callBackground("networks.upsert", { ...base, ...form, id: base.id });
    selected.refresh();
    networks.refresh();
    setForm({});
  };

  return (
    <div>
      <ScreenHeader title="Settings" onClose={() => navigate("")} />
      <div className="space-y-3 p-4">
        <Field label="Network">
          <select
            className="w-full rounded-lg border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm"
            value={selected.data?.id ?? ""}
            onChange={async (e) => {
              await callBackground("networks.select", e.target.value);
              selected.refresh();
            }}
          >
            {visibleNetworks(networks.data, showTestnets.data, selected.data?.id).map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </Field>

        <label className="flex items-center justify-between rounded-lg border border-slate-300 dark:border-slate-800 px-3 py-2">
          <span className="text-sm">
            Show test networks
            <span className="block text-xs text-slate-400">
              STRATO Helium &amp; Sepolia testnets
            </span>
          </span>
          <ToggleSwitch on={!!showTestnets.data} onClick={toggleTestnets} />
        </label>

        <Card className="space-y-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Notifications</p>
          <label className="flex items-center justify-between py-1">
            <span className="text-sm">
              Desktop notifications
              <span className="block text-xs text-slate-400">Show OS pop-ups for alerts below</span>
            </span>
            <ToggleSwitch on={!!notif.data?.os} onClick={() => toggleNotif("os")} />
          </label>
          <label className="flex items-center justify-between py-1">
            <span className="text-sm">Bridge finalization</span>
            <ToggleSwitch on={notif.data?.bridge !== false} onClick={() => toggleNotif("bridge")} />
          </label>
          <label className="flex items-center justify-between py-1">
            <span className="text-sm">Incoming transfers</span>
            <ToggleSwitch
              on={notif.data?.incoming !== false}
              onClick={() => toggleNotif("incoming")}
            />
          </label>
          <label className="flex items-center justify-between py-1">
            <span className="text-sm">Liquidation risk (loans &amp; CDPs)</span>
            <ToggleSwitch on={notif.data?.loan !== false} onClick={() => toggleNotif("loan")} />
          </label>
        </Card>

        {selected.data && (
          <Card className="space-y-2">
            <Field label="RPC URL">
              <Input
                defaultValue={selected.data.rpcUrl}
                onChange={(e) => setForm((f) => ({ ...f, rpcUrl: e.target.value }))}
              />
            </Field>
            <Field label="Chain ID (decimal)">
              <Input
                inputMode="numeric"
                defaultValue={selected.data.chainId}
                onChange={(e) => setForm((f) => ({ ...f, chainId: e.target.value.trim() }))}
              />
            </Field>
            <Field label="BLOC URL">
              <Input
                defaultValue={selected.data.blocUrl ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, blocUrl: e.target.value }))}
              />
            </Field>
            <Field label="strato-api URL">
              <Input
                defaultValue={selected.data.stratoApiUrl ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, stratoApiUrl: e.target.value }))}
              />
            </Field>
            <Field label="Block explorer URL">
              <Input
                defaultValue={selected.data.explorerUrl ?? ""}
                placeholder="https://stratoscan.strato.nexus"
                onChange={(e) => setForm((f) => ({ ...f, explorerUrl: e.target.value.trim() }))}
              />
            </Field>
            <Field label="Native token symbol">
              <Input
                defaultValue={selected.data.nativeSymbol ?? ""}
                placeholder="USDST"
                onChange={(e) => setForm((f) => ({ ...f, nativeSymbol: e.target.value.trim() }))}
              />
            </Field>
            <Field label="OAuth issuer (for Login with STRATO)">
              <Input
                defaultValue={selected.data.oauthIssuer ?? ""}
                placeholder="https://keycloak.example/auth/realms/<realm>"
                onChange={(e) => setForm((f) => ({ ...f, oauthIssuer: e.target.value.trim() }))}
              />
            </Field>
            <Field label="OAuth client ID">
              <Input
                defaultValue={selected.data.oauthClientId ?? ""}
                placeholder="strato-wallet-extension"
                onChange={(e) => setForm((f) => ({ ...f, oauthClientId: e.target.value.trim() }))}
              />
            </Field>
            <Button onClick={save}>Save network</Button>
          </Card>
        )}

        <ConnectedSites />

        <Button
          variant="danger"
          onClick={async () => {
            await callBackground("wallet.lock");
            navigate("");
            // Re-run App so it re-checks lock state and shows the Unlock screen.
            window.location.reload();
          }}
        >
          Lock wallet
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------- Connected sites
function ConnectedSites() {
  const perms = useAsync<OriginPermission[]>(() => callBackground("permissions.list"));
  const sites = perms.data ?? [];

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Connected sites</p>
      {sites.length === 0 ? (
        <p className="text-xs text-slate-400">No sites connected.</p>
      ) : (
        sites.map((p) => (
          <div
            key={p.origin}
            className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2"
          >
            <span className="truncate text-xs" title={p.origin}>
              {p.origin.replace(/^https?:\/\//, "")}
            </span>
            <button
              className="ml-2 shrink-0 text-xs text-red-600 dark:text-red-400 underline"
              onClick={async () => {
                await callBackground("permissions.revoke", p.origin);
                perms.refresh();
              }}
            >
              Disconnect
            </button>
          </div>
        ))
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Setup
export function Setup({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"choose" | "create" | "importKey" | "importSeed">("choose");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [secret, setSecret] = useState("");
  const [seedPhrase, setSeedPhrase] = useState("");
  const [phrase, setPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const checkPassword = () => {
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return false;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return false;
    }
    return true;
  };

  const create = async () => {
    setError(null);
    if (!checkPassword()) return;
    setBusy(true);
    try {
      const generated = await callBackground<string>("wallet.create", password);
      setPhrase(generated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importKey = async () => {
    setError(null);
    if (!checkPassword()) return;
    setBusy(true);
    try {
      await callBackground("wallet.create", password);
      await callBackground("accounts.importPrivateKey", secret.trim());
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importSeed = async () => {
    setError(null);
    if (!checkPassword()) return;
    setBusy(true);
    try {
      // Create the keystore directly from the imported phrase (becomes Wallet 1).
      await callBackground("wallet.create", password, seedPhrase);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (phrase) {
    return (
      <div className="space-y-3 p-4">
        <h2 className="text-base font-semibold">Your recovery phrase</h2>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          Write these 12 words down and keep them safe. Anyone with this phrase controls your funds.
        </p>
        <Card className="bg-slate-50 dark:bg-slate-900">
          <div className="grid grid-cols-3 gap-2 text-sm">
            {phrase.split(" ").map((w, i) => (
              <span key={i} className="rounded bg-white dark:bg-slate-900 px-2 py-1 text-center">
                <span className="text-slate-400">{i + 1}.</span> {w}
              </span>
            ))}
          </div>
        </Card>
        <Button onClick={onDone}>I've saved it — continue</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-col items-center gap-2 py-3">
        <Logo className="h-12 w-12" />
        <h2 className="text-base font-semibold">
          {mode === "importKey"
            ? "Import private key"
            : mode === "importSeed"
              ? "Import recovery phrase"
              : "Create your wallet"}
        </h2>
      </div>
      {mode === "choose" && (
        <div className="space-y-2">
          <Button onClick={() => setMode("create")}>Create a new wallet</Button>
          <Button variant="secondary" onClick={() => setMode("importSeed")}>
            Import a recovery phrase
          </Button>
          <Button variant="secondary" onClick={() => setMode("importKey")}>
            Import a private key
          </Button>
        </div>
      )}
      {mode !== "choose" && (
        <div className="space-y-3">
          {mode === "importKey" && (
            <Field label="Private key (0x…)">
              <Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="0x…" />
            </Field>
          )}
          {mode === "importSeed" && (
            <Field label="Recovery phrase (12/24 words)">
              <textarea
                value={seedPhrase}
                onChange={(e) => setSeedPhrase(e.target.value)}
                rows={3}
                placeholder="word1 word2 word3 …"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm outline-none focus:border-[#001B70] focus:ring-1 focus:ring-[#001B70]"
              />
            </Field>
          )}
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirm password">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button
            disabled={
              busy ||
              (mode === "importSeed" && seedPhrase.trim().split(/\s+/).length < 12) ||
              (mode === "importKey" && !secret)
            }
            onClick={() =>
              mode === "importKey" ? importKey() : mode === "importSeed" ? importSeed() : create()
            }
          >
            {busy
              ? "Working…"
              : mode === "importKey" || mode === "importSeed"
                ? "Import"
                : "Create"}
          </Button>
          <Button variant="ghost" onClick={() => setMode("choose")}>
            Back
          </Button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Unlock
export function Unlock({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await callBackground("wallet.unlock", password);
      onUnlocked();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-col items-center gap-2 py-4">
        <Logo className="h-14 w-14" />
        <h2 className="text-base font-semibold">STRATO Wallet</h2>
      </div>
      <Field label="Password">
        <Input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button disabled={busy} onClick={submit}>
        {busy ? "Unlocking…" : "Unlock"}
      </Button>
    </div>
  );
}

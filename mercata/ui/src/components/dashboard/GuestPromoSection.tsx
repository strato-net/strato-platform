import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { requestWalletConnection } from "@/lib/auth";
import { useEarnContext } from "@/context/EarnContext";
import { useTokenContext } from "@/context/TokenContext";
import { useRewardsUserInfo } from "@/hooks/useRewardsUserInfo";
import { useRewards } from "@/hooks/useRewards";
import { findBestEarnApyInfo, buildEarnApyMap } from "@/utils/earnUtils";
import { rewardsEnabled, usdstAddress } from "@/lib/constants";

/** GOLDST / SILVST — images from TokenContext (earningAssets ∪ inactiveTokens) */
const METAL_PROMO_TOKEN_ADDRESSES = [
  "cdc93d30182125e05eec985b631c7c61b3f63ff0",
  "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94",
] as const;

const BRIDGE_IN_TOKEN_ADDRESSES = [
  "6aeacaa19c68e53035bf495d15e0a328fc600ba8", // USDC
  "5ed0bdfb378ac0d06249d70759536d7a41906216", // USDT
  "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9", // WBTC
  "93fb7295859b2d70199e0a4883b7c320cf874e6c", // ETH
] as const;

const formatDailyPoints = (value: number): string => {
  if (value < 1e-12) return "tiny";
  if (value >= 0.01) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const str = value.toFixed(20);
  const decimalIndex = str.indexOf(".");
  let firstNonZero = decimalIndex + 1;
  while (firstNonZero < str.length && str[firstNonZero] === "0") firstNonZero++;
  const decimals = Math.min(firstNonZero - decimalIndex, 12);
  return value.toFixed(decimals);
};

type PromoTokenRow = { address: string; imageUrl: string | null; symbol: string };

const resolvePromoRows = (
  addresses: readonly string[],
  earningAssets: { address?: string; _symbol?: string; images?: { value: string }[] }[],
  inactiveTokens: { address?: string; _symbol?: string; images?: { value: string }[] }[]
): PromoTokenRow[] => {
  const all = [...earningAssets, ...inactiveTokens];
  return addresses.map((address) => {
    const t = all.find(
      (tok) => tok.address?.toLowerCase() === address.toLowerCase()
    );
    return {
      address,
      imageUrl: t?.images?.[0]?.value ?? null,
      symbol: t?._symbol ?? "??",
    };
  });
};

interface GuestPromoSectionProps {
  variant: 1 | 2 | 3; // 1 = logged out, 2 = logged in 0 portfolio, 3 = logged in with portfolio
}

const GuestPromoSection = ({ variant }: GuestPromoSectionProps) => {
  const navigate = useNavigate();
  const [rewardsButtonHovered, setRewardsButtonHovered] = useState(false);
  const { tokenApys, tokenApysLoaded } = useEarnContext();
  const { userRewards } = useRewardsUserInfo();
  const { state: rewardsState } = useRewards();
  const { earningAssets, inactiveTokens, loadingEarningAssets } = useTokenContext();
  const tokensLoading = loadingEarningAssets || earningAssets.length === 0;

  const metalRows = useMemo(
    () => resolvePromoRows(METAL_PROMO_TOKEN_ADDRESSES, earningAssets, inactiveTokens),
    [earningAssets, inactiveTokens]
  );

  const stableRows = useMemo(
    () => resolvePromoRows(BRIDGE_IN_TOKEN_ADDRESSES, earningAssets, inactiveTokens),
    [earningAssets, inactiveTokens]
  );

  const earnCardTitleIcon = useMemo(() => {
    const t = [...earningAssets, ...inactiveTokens].find(
      (tok) => tok.address?.toLowerCase() === usdstAddress.toLowerCase()
    );
    return {
      url: t?.images?.[0]?.value ?? null,
      symbol: t?._symbol ?? "",
    };
  }, [earningAssets, inactiveTokens]);

  const usdstApy = useMemo(() => {
    const info = findBestEarnApyInfo(tokenApys, "22550671fcad04a213697ac7ae4f4366e96446ed");
    return info && info.total > 0 ? info.total.toFixed(1) : null;
  }, [tokenApys]);

  const { dailyPointsStr, emissionFillPct } = useMemo(() => {
    if (!userRewards?.activities?.length) return { dailyPointsStr: null, emissionFillPct: 0 };
    let totalPerSec = 0n;
    for (const { personalEmissionRate } of userRewards.activities) {
      if (personalEmissionRate) totalPerSec += BigInt(personalEmissionRate);
    }
    if (totalPerSec === 0n) return { dailyPointsStr: null, emissionFillPct: 0 };
    const perDay = Number((totalPerSec * 86400n) / BigInt(1e9)) / 1e9;
    console.log("[GuestPromoSection] dailyPoints full precision:", perDay);

    let fillPct = 0;
    const totalEmission = rewardsState?.totalRewardsEmission;
    if (totalEmission && BigInt(totalEmission) > 0n) {
      const raw = Math.min(100, Number((totalPerSec * 10000n) / BigInt(totalEmission)) / 100);
      fillPct = raw > 0 ? Math.max(raw, 2) : 0;
    }

    return { dailyPointsStr: formatDailyPoints(perDay), emissionFillPct: fillPct };
  }, [userRewards, rewardsState]);

  const highestAvailableApy = useMemo(() => {
    let best = 0;
    for (const info of buildEarnApyMap(tokenApys).values()) {
      if (info.total > best) best = info.total;
    }
    return best > 0 ? best.toFixed(1) : null;
  }, [tokenApys]);

  if (variant === 3 && rewardsEnabled) {
    return (
      <div className="mb-8">
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "linear-gradient(135deg, #0A0F29 0%, #001B70 55%, #102a80 100%)" }}
        >
          <div className="flex flex-col lg:flex-row">
            <div className="flex-1 px-4 py-5 md:px-6 md:py-6 lg:px-8 lg:py-7">
              <div className="inline-flex items-center gap-2 bg-white/10 rounded-full px-3 py-1 mb-5">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-white text-xs font-medium">Live Now</span>
              </div>
              <h1 className="text-3xl md:text-4xl lg:text-[2.75rem] font-bold text-white mb-2 leading-tight">
                {tokenApysLoaded && highestAvailableApy
                  ? `Earn Up to ${highestAvailableApy}% APY`
                  : !tokenApysLoaded
                    ? <span className="inline-flex items-center gap-2">Earn Up to <Loader2 className="w-7 h-7 animate-spin opacity-60" /> APY</span>
                    : "Start Earning Today"
                }
              </h1>
              <p className="text-white/60 text-sm md:text-base mb-6">
                Including 11,111 reward points daily, just for holding
              </p>
              <button
                onClick={() => navigate("/dashboard/earn")}
                className="inline-flex items-center gap-2 border border-white/30 text-white rounded-full px-5 py-2.5 text-sm font-medium hover:bg-white/10 transition-colors"
              >
                Start Earning
                <ArrowRight size={16} />
              </button>
            </div>

            <div className="lg:w-[360px] xl:w-[400px] px-4 py-5 md:px-6 md:py-6 bg-white/5 border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col justify-center gap-2">
              <h3 className="text-white font-bold text-xl mb-1">Your Daily Points</h3>
              <p className="text-white/50 text-base mb-4">
                {dailyPointsStr ? `${dailyPointsStr} pts/day` : "—"}
              </p>
              <div>
                <div className="w-full h-2 bg-white/10 rounded-full mb-5">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-[width] duration-[400ms]"
                    style={{ width: rewardsButtonHovered ? "100%" : `${emissionFillPct}%` }}
                  />
                </div>
                <button
                  onClick={() => navigate("/dashboard/rewards")}
                  onMouseEnter={() => setRewardsButtonHovered(true)}
                  onMouseLeave={() => setRewardsButtonHovered(false)}
                  className="text-white/50 text-sm hover:text-white/70 transition-colors inline-flex items-center gap-1 self-start"
                >
                  See Rewards
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 mb-8">
      {/* Hero Banner */}
      <div
        className={`rounded-2xl overflow-hidden ${rewardsEnabled ? "" : "hidden"}`}
        style={{
          background:
            "linear-gradient(135deg, #0A0F29 0%, #001B70 55%, #102a80 100%)",
        }}
      >
        <div className="flex flex-col lg:flex-row">
          <div className="flex-1 px-4 py-5 md:px-6 md:py-6 lg:px-8 lg:py-7">
            <div className="inline-flex items-center gap-2 bg-white/10 rounded-full px-3 py-1 mb-5">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-white text-xs font-medium">Live Now</span>
            </div>

            <h1 className="text-3xl md:text-4xl lg:text-[2.75rem] font-bold text-white mb-2 leading-tight">
              {tokenApysLoaded && highestAvailableApy
                ? `Earn Up to ${highestAvailableApy}% APY`
                : !tokenApysLoaded
                  ? <span className="inline-flex items-center gap-2">Earn Up to <Loader2 className="w-7 h-7 animate-spin opacity-60" /> APY</span>
                  : "Start Earning Today"
              }
            </h1>
            <p className="text-white/60 text-sm md:text-base mb-6">
              Plus 11,111 reward points daily, just for holding
            </p>

            <button
              onClick={() => variant === 1 ? requestWalletConnection() : navigate("/dashboard/earn")}
              className="inline-flex items-center gap-2 border border-white/30 text-white rounded-full px-5 py-2.5 text-sm font-medium hover:bg-white/10 transition-colors"
            >
              Start Earning
              <ArrowRight size={16} />
            </button>
          </div>

          <div className="lg:w-[360px] xl:w-[400px] px-4 py-5 md:px-6 md:py-6 bg-white/5 border-t lg:border-t-0 lg:border-l border-white/10 flex flex-col justify-center gap-2">
            <div className="inline-flex items-center self-start border border-blue-400/50 rounded-full px-3 py-0.5 mb-2">
              <span className="text-blue-400 text-xs font-medium">Preview</span>
            </div>

            <h3 className="text-white font-bold text-xl mb-1">Your Daily Points</h3>
            <p className="text-white/50 text-base mb-4">11,111 pts/day</p>

            <div>
              <div className="w-full h-2 bg-white/10 rounded-full mb-5">
                <div
                  className="h-full bg-blue-500 rounded-full transition-[width] duration-[400ms]"
                  style={{ width: rewardsButtonHovered ? "100%" : "80%" }}
                />
              </div>
              {variant === 1 ? (
                <button
                  onClick={() => requestWalletConnection()}
                  onMouseEnter={() => setRewardsButtonHovered(true)}
                  onMouseLeave={() => setRewardsButtonHovered(false)}
                  className="text-white/50 text-sm hover:text-white/70 transition-colors inline-flex items-center gap-1 self-start"
                >
                  Connect wallet to start earning
                  <ArrowRight size={14} />
                </button>
              ) : (
                <button
                  onClick={() => navigate("/dashboard/rewards")}
                  onMouseEnter={() => setRewardsButtonHovered(true)}
                  onMouseLeave={() => setRewardsButtonHovered(false)}
                  className="text-white/50 text-sm hover:text-white/70 transition-colors inline-flex items-center gap-1 self-start"
                >
                  See Rewards
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Buy Tokenized Gold and Silver */}
        <div className="bg-card border border-border rounded-2xl p-6 flex flex-col justify-between min-h-[240px]">
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-foreground mb-2">
              Buy Tokenized Gold and Silver
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
              Own real precious metals on-chain. Trade 24/7, no vault fees,
              redeemable for physical bullion.
            </p>
            <span className="inline-block bg-[#e06b5a] text-white text-xs font-semibold rounded-full px-3 py-1">
              GOLDST · SILVST
            </span>
          </div>

          <div className="flex items-end justify-between mt-6">
            <div className="flex items-center -space-x-1.5">
              {metalRows.map((row, i) =>
                row.imageUrl ? (
                  <img
                    key={row.address}
                    src={row.imageUrl}
                    alt={row.symbol}
                    className="w-8 h-8 rounded-full object-cover border-2 border-card"
                    style={{ zIndex: metalRows.length - i }}
                  />
                ) : (
                  <div
                    key={row.address}
                    className="w-8 h-8 rounded-full bg-muted flex items-center justify-center border-2 border-card"
                    style={{ zIndex: metalRows.length - i }}
                  >
                    {tokensLoading
                      ? <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                      : <span className="text-foreground text-[11px] font-bold">{row.symbol.slice(0, 2)}</span>
                    }
                  </div>
                )
              )}
            </div>

            <button
              onClick={() => navigate("/dashboard/deposits?tab=metals")}
              className="text-foreground text-sm font-semibold inline-flex items-center gap-1.5 hover:opacity-70 transition-opacity"
            >
              View assets
              <ArrowRight size={16} />
            </button>
          </div>
        </div>

        {/* Earn on USDST */}
        <div className="bg-card border border-border rounded-2xl p-6 flex flex-col justify-between min-h-[240px]">
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-foreground mb-2 flex items-center gap-1 flex-wrap">
              Earn on
              {earnCardTitleIcon.url ? (
                <img
                  src={earnCardTitleIcon.url}
                  alt={earnCardTitleIcon.symbol || "Earn"}
                  className="inline w-7 h-7 rounded-full object-cover mx-0.5 border border-border align-middle"
                />
              ) : tokensLoading ? (
                <span className="inline-flex w-7 h-7 rounded-full bg-muted items-center justify-center mx-0.5 align-middle">
                  <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                </span>
              ) : (
                <span className="inline-flex w-7 h-7 rounded-full bg-[#10b981] items-center justify-center mx-0.5 align-middle">
                  <span className="text-white text-xs font-bold">$</span>
                </span>
              )}
              USDST
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
              Deposit USD or Stablecoins and put idle balances to work with
              yield generated through lending.
            </p>
            {usdstApy && (
              <span className="inline-block border border-green-500 bg-green-500/10 text-green-700 dark:text-green-400 text-xs font-semibold rounded-full px-3 py-1">
                {usdstApy}% APY
              </span>
            )}
          </div>

          <div className="flex items-end justify-between mt-6">
            <div className="flex items-center -space-x-1.5">
              {stableRows.map((row, i) =>
                row.imageUrl ? (
                  <img
                    key={row.address}
                    src={row.imageUrl}
                    alt={row.symbol}
                    className="w-8 h-8 rounded-full object-cover border-2 border-card"
                    style={{ zIndex: stableRows.length - i }}
                  />
                ) : (
                  <div
                    key={row.address}
                    className="w-8 h-8 rounded-full bg-muted flex items-center justify-center border-2 border-card"
                    style={{ zIndex: stableRows.length - i }}
                  >
                    {tokensLoading
                      ? <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                      : <span className="text-foreground text-[11px] font-bold">{row.symbol.slice(0, 2)}</span>
                    }
                  </div>
                )
              )}
            </div>

            <button
              onClick={() => navigate("/dashboard/deposits")}
              className="text-foreground text-sm font-semibold inline-flex items-center gap-1.5 hover:opacity-70 transition-opacity"
            >
              Deposit
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GuestPromoSection;

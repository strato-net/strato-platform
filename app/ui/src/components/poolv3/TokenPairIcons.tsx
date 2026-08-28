import { PoolV3 } from "@/interface";

const sizeClasses = {
  sm: "w-6 h-6",
  md: "w-7 h-7",
  lg: "w-9 h-9",
} as const;

/** Overlapping token-logo pair, used wherever a pool pair is displayed. */
const TokenPairIcons = ({
  token0,
  token1,
  size = "sm",
}: {
  token0: PoolV3["token0"];
  token1: PoolV3["token1"];
  size?: keyof typeof sizeClasses;
}) => (
  <div className="flex -space-x-1.5 flex-shrink-0">
    {[token0, token1].map((token) =>
      token.image ? (
        <img
          key={token.address}
          src={token.image}
          alt={token.symbol}
          className={`${sizeClasses[size]} rounded-full object-cover border border-border bg-card`}
        />
      ) : (
        <div
          key={token.address}
          className={`${sizeClasses[size]} rounded-full flex items-center justify-center text-[10px] text-primary-foreground font-medium bg-primary border border-border`}
        >
          {token.symbol?.slice(0, 1)}
        </div>
      )
    )}
  </div>
);

export default TokenPairIcons;

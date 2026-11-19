import { PoolV3 } from "@/interface";

const sizeClasses = {
  xs: "w-5 h-5",
  sm: "w-6 h-6",
  md: "w-7 h-7",
  lg: "w-9 h-9",
} as const;

/** One token's logo, or its initial where it has none. */
export const TokenLogo = ({ token, size = "sm" }: { token: PoolV3["token0"]; size?: keyof typeof sizeClasses }) =>
  token.image ? (
    <img
      src={token.image}
      alt={token.symbol}
      className={`${sizeClasses[size]} flex-shrink-0 rounded-full object-cover border border-border bg-card`}
    />
  ) : (
    <div
      className={`${sizeClasses[size]} flex-shrink-0 rounded-full flex items-center justify-center text-[10px] text-white font-medium bg-strato-blue border border-border`}
    >
      {token.symbol?.slice(0, 1)}
    </div>
  );

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
    {[token0, token1].map((token) => (
      <TokenLogo key={token.address} token={token} size={size} />
    ))}
  </div>
);

export default TokenPairIcons;

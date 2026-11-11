import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { strip0x } from "@/services/userWallets";

export interface StakingValidatorMetadata {
  address: string;
  name: string;
  active: boolean;
  status: number;
  estimatedApy: string;
}

export interface StakingMetadata {
  stakingAddress: string;
  stratoTokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  validators: StakingValidatorMetadata[];
}

export interface CDPAssetMetadata {
  asset: string;
  symbol: string;
  decimals: number;
  isPaused: boolean;
  isSupported: boolean;
}

export interface CDPMetadata {
  registryAddress: string;
  engineAddress: string;
  vaultAddress: string;
  usdstAddress: string;
  assets: CDPAssetMetadata[];
}

export interface PoolTokenMetadata {
  address: string;
  _symbol: string;
  customDecimals: number;
  balance?: string;
  poolBalance?: string;
}

export interface PoolMetadata {
  address: string;
  poolName: string;
  isStable: boolean;
  isPaused: boolean;
  isDisabled: boolean;
  tokenA: PoolTokenMetadata;
  tokenB: PoolTokenMetadata;
  coins?: PoolTokenMetadata[];
  lpToken?: PoolTokenMetadata;
}

export interface PoolV3Metadata {
  address: string;
  token0: PoolTokenMetadata;
  token1: PoolTokenMetadata;
}

export interface PositionV3Metadata {
  tokenId: string;
  poolAddress: string;
}

export interface V3AllowanceMetadata {
  pools: PoolV3Metadata[];
  positions: PositionV3Metadata[];
}

export function resolveV3AllowanceInputs(
  func: string,
  args: string[],
  metadata?: V3AllowanceMetadata
): { tokenAddress: string; amount: string }[] {
  let poolAddress = "";
  let amount0 = "0";
  let amount1 = "0";
  if (func === "mint" && args.length >= 9) {
    poolAddress = args[0] ?? "";
    amount0 = args[3] ?? "0";
    amount1 = args[4] ?? "0";
  } else if (func === "increaseLiquidity" && args.length >= 6) {
    poolAddress = metadata?.positions.find((position) =>
      position.tokenId === String(args[0] ?? "")
    )?.poolAddress ?? "";
    amount0 = args[1] ?? "0";
    amount1 = args[2] ?? "0";
  }
  const pool = metadata?.pools.find((item) =>
    strip0x(item.address) === strip0x(poolAddress)
  );
  if (!pool) return [];
  return [
    { tokenAddress: pool.token0.address, amount: amount0 },
    { tokenAddress: pool.token1.address, amount: amount1 },
  ];
}

export interface DeployedCollateralPosition {
  asset: string;
  symbol: string;
  amount: string;
  decimals: number;
}

export interface DeployedStakingPosition {
  tokenSymbol: string;
  tokenDecimals: number;
  stakedAmount: string;
  unbondingAmount: string;
  validatorCount: number;
}

export interface DeployedPositions {
  collateral: DeployedCollateralPosition[];
  staking: DeployedStakingPosition;
}

export function useStakingMetadata() {
  return useQuery({
    queryKey: ["protocol-metadata", "staking"],
    staleTime: 60_000,
    queryFn: async (): Promise<StakingMetadata> => {
      const { data } = await api.get("/api/staking/info/public", { skipErrorToast: true });
      return {
        stakingAddress: strip0x(String(data?.stakingAddress ?? "")),
        stratoTokenAddress: strip0x(String(data?.stratoTokenAddress ?? "")),
        tokenSymbol: String(data?.tokenSymbol ?? "STRATO"),
        tokenDecimals: Number(data?.tokenDecimals ?? 18),
        validators: (Array.isArray(data?.validators) ? data.validators : []).map((validator: any) => ({
          address: strip0x(String(validator?.address ?? validator?.validatorAddress ?? "")),
          name: String(validator?.name ?? ""),
          active: !!validator?.active,
          status: Number(validator?.status ?? 0),
          estimatedApy: String(validator?.estimatedApy ?? ""),
        })),
      };
    },
  });
}

export function useCDPMetadata() {
  return useQuery({
    queryKey: ["protocol-metadata", "cdp"],
    staleTime: 60_000,
    queryFn: async (): Promise<CDPMetadata> => {
      const { data } = await api.get("/api/cdp/metadata", { skipErrorToast: true });
      return {
        registryAddress: strip0x(String(data?.registryAddress ?? "")),
        engineAddress: strip0x(String(data?.engineAddress ?? "")),
        vaultAddress: strip0x(String(data?.vaultAddress ?? "")),
        usdstAddress: strip0x(String(data?.usdstAddress ?? "")),
        assets: (Array.isArray(data?.assets) ? data.assets : []).map((asset: any) => ({
          asset: strip0x(String(asset?.asset ?? "")),
          symbol: String(asset?.symbol ?? "ASSET"),
          decimals: Number(asset?.decimals ?? 18),
          isPaused: !!asset?.isPaused,
          isSupported: asset?.isSupported !== false,
        })),
      };
    },
  });
}

export function usePoolMetadata() {
  return useQuery({
    queryKey: ["protocol-metadata", "pools"],
    staleTime: 30_000,
    queryFn: async (): Promise<PoolMetadata[]> => {
      const { data } = await api.get("/api/swap-pools", { skipErrorToast: true });
      if (!Array.isArray(data)) return [];
      const token = (raw: any): PoolTokenMetadata => ({
        address: strip0x(String(raw?.address ?? "")),
        _symbol: String(raw?._symbol ?? "TOKEN"),
        customDecimals: Number(raw?.customDecimals ?? 18),
        balance: String(raw?.balance ?? "0"),
        poolBalance: String(raw?.poolBalance ?? "0"),
      });
      return data.map((pool: any) => ({
        address: strip0x(String(pool?.address ?? "")),
        poolName: String(pool?.poolName ?? pool?.poolSymbol ?? "Pool"),
        isStable: !!pool?.isStable,
        isPaused: !!pool?.isPaused,
        isDisabled: !!pool?.isDisabled,
        tokenA: token(pool?.tokenA),
        tokenB: token(pool?.tokenB),
        coins: Array.isArray(pool?.coins)
          ? [...pool.coins].sort((a: any, b: any) => Number(a.coinIndex) - Number(b.coinIndex)).map(token)
          : undefined,
        lpToken: pool?.lpToken ? token(pool.lpToken) : undefined,
      })).filter((pool: PoolMetadata) => pool.address && !pool.isDisabled);
    },
  });
}

/** Pool tokens and owned position-to-pool links needed to reconstruct V3 allowances. */
export function useV3AllowanceMetadata(
  ownerAddresses?: string | string[] | null,
  enabled = true
) {
  const owners = [...new Set(
    (Array.isArray(ownerAddresses) ? ownerAddresses : [ownerAddresses])
      .map((address) => strip0x(address ?? ""))
      .filter((address) => address.length === 40)
  )].sort();
  return useQuery({
    queryKey: ["protocol-metadata", "v3-allowances", owners],
    enabled: enabled && owners.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<V3AllowanceMetadata> => {
      const [poolsResult, ...positionResults] = await Promise.all([
        api.get("/api/poolv3/pools", { skipErrorToast: true }),
        ...owners.map((owner) => api.get("/api/poolv3/positions", {
          skipErrorToast: true,
          headers: { "X-Wallet-Address": owner },
        })),
      ]);
      const token = (raw: any): PoolTokenMetadata => ({
        address: strip0x(String(raw?.address ?? "")),
        _symbol: String(raw?._symbol ?? "TOKEN"),
        customDecimals: Number(raw?.customDecimals ?? 18),
      });
      return {
        pools: (Array.isArray(poolsResult.data) ? poolsResult.data : []).map((pool: any) => ({
          address: strip0x(String(pool?.address ?? "")),
          token0: token(pool?.token0),
          token1: token(pool?.token1),
        })).filter((pool: PoolV3Metadata) =>
          pool.address && pool.token0.address && pool.token1.address
        ),
        positions: positionResults.flatMap((result) =>
          Array.isArray(result.data) ? result.data : []
        ).map((position: any) => ({
          tokenId: String(position?.tokenId ?? ""),
          poolAddress: strip0x(String(position?.poolAddress ?? "")),
        })).filter((position: PositionV3Metadata) =>
          position.tokenId && position.poolAddress
        ),
      };
    },
  });
}

/** Assets held by protocol contracts on behalf of a multisig treasury. */
export function useDeployedPositions(ownerAddress?: string | null) {
  const owner = strip0x(ownerAddress ?? "");
  return useQuery({
    queryKey: ["deployed-positions", owner],
    enabled: owner.length === 40,
    staleTime: 15_000,
    refetchInterval: 15_000,
    queryFn: async (): Promise<DeployedPositions> => {
      const [vaultResult, stakingResult] = await Promise.all([
        api.get(`/api/cdp/vaults?address=${owner}`, {
          skipErrorToast: true,
          headers: { "X-Wallet-Address": owner },
        }),
        api.get(`/api/staking/info?address=${owner}`, { skipErrorToast: true }),
      ]);
      const vaults = vaultResult.data;
      const staking = stakingResult.data;
      const collateral = (Array.isArray(vaults) ? vaults : []).map((vault: any) => ({
        asset: strip0x(String(vault?.asset ?? "")),
        symbol: String(vault?.symbol ?? "ASSET"),
        amount: String(vault?.collateralAmount ?? "0"),
        decimals: Number(vault?.collateralAmountDecimals ?? 18),
      })).filter((position: DeployedCollateralPosition) => {
        try {
          return BigInt(position.amount) > 0n;
        } catch {
          return false;
        }
      });
      const validators = Array.isArray(staking?.validators) ? staking.validators : [];
      const validatorCount = validators.filter((validator: any) => {
        try {
          return BigInt(validator?.userStake ?? "0") > 0n;
        } catch {
          return false;
        }
      }).length;
      const unbondingAmount = (Array.isArray(staking?.unbondingRequests) ? staking.unbondingRequests : [])
        .filter((request: any) => !request?.claimed)
        .reduce((sum: bigint, request: any) => {
          try {
            return sum + BigInt(request?.amount ?? "0");
          } catch {
            return sum;
          }
        }, 0n);
      return {
        collateral,
        staking: {
          tokenSymbol: String(staking?.tokenSymbol ?? "STRATO"),
          tokenDecimals: Number(staking?.tokenDecimals ?? 18),
          stakedAmount: String(staking?.userTotalStake ?? "0"),
          unbondingAmount: unbondingAmount.toString(),
          validatorCount,
        },
      };
    },
  });
}

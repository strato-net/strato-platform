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
        coins: Array.isArray(pool?.coins) ? pool.coins.map(token) : undefined,
        lpToken: pool?.lpToken ? token(pool.lpToken) : undefined,
      })).filter((pool: PoolMetadata) => pool.address && !pool.isDisabled);
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
      const [vaultResult, stakingResult] = await Promise.allSettled([
        api.get(`/api/cdp/vaults?address=${owner}`, { skipErrorToast: true }),
        api.get(`/api/staking/info?address=${owner}`, { skipErrorToast: true }),
      ]);
      if (vaultResult.status === "rejected" && stakingResult.status === "rejected") {
        throw vaultResult.reason;
      }
      const vaults = vaultResult.status === "fulfilled" ? vaultResult.value.data : [];
      const staking = stakingResult.status === "fulfilled" ? stakingResult.value.data : {};
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

import { borrow } from "./borrow";
import { goldVault } from "./goldVault";
import { liquidity } from "./liquidity";
import { staking } from "./staking";
import { usdstVault } from "./usdstVault";
import type { ProductLandingConfig } from "./types";

/** Registry keyed by the `/defi/<slug>` route segment. */
export const LANDING_CONFIGS: Record<string, ProductLandingConfig> = {
  [usdstVault.slug]: usdstVault,
  [goldVault.slug]: goldVault,
  [liquidity.slug]: liquidity,
  [borrow.slug]: borrow,
  [staking.slug]: staking,
};

export type LandingSlug = keyof typeof LANDING_CONFIGS;

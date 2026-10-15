/**
 * Icon artwork for yield vaults.
 *
 * Vault share tokens carry no image metadata on chain, so unlike ERC-20s we
 * cannot resolve their icon from `token.images[0].value`. Instead the artwork
 * is hosted on the file server and mapped here by vault key — changing an icon
 * is a one-line edit (or a re-upload under the same filename).
 */

/** Savings vault key. The yield vaults use the keys from `VAULT_KEYS`. */
export const SAVE_USDST_VAULT_KEY = "save-usdst";

export const VAULT_ICON_BASE_URL = "https://fileserver.mercata.blockapps.net/highway/";

/**
 * Vault key -> filename on the icon file server. A key left out (or pointed at
 * an empty string) falls back to the icon the UI drew before, so vaults can be
 * given artwork one at a time.
 */
const VAULT_ICON_FILES: Record<string, string> = {
  [SAVE_USDST_VAULT_KEY]: "179b57839a7885c9347ad826981d745dd039274674206cf4c9ba499eadefb8b5.png",
  "eth-carry": "b31ebf44566cd8e5f21238c72b78cc14effa1ee828786e3ab546c901b7d2b860.png",
//   "wbtc-carry": "wbtc-carry.png",
//   "usdc-yield": "usdc-yield.png",
  "goldst-yield": "24043fcf78a7586414e2740b1debdd1d68a4e53477dcc0b7eaf06566fb324eb2.png",
//   "silvst-yield": "silvst-yield.png",
};

/**
 * Share-token symbol -> vault key, so portfolio rows (which only know the token
 * they hold) resolve to the same artwork. Compared lower-cased.
 */
const SHARE_SYMBOL_TO_VAULT_KEY: Record<string, string> = {
  saveusdst: SAVE_USDST_VAULT_KEY,
  carryeth: "eth-carry",
  yieldhype: "hype-yield",
  // Helium was initialized with the legacy symbol before the product naming was finalized.
  carryhype: "hype-yield",
  carrywbtc: "wbtc-carry",
  yieldusdc: "usdc-yield",
  yieldgoldst: "goldst-yield",
  yieldsilvst: "silvst-yield",
};

/** Absolute URL of a vault's icon, or `null` when no artwork is configured. */
export const getVaultIconUrl = (vaultKey: string | null | undefined): string | null => {
  if (!vaultKey) return null;
  const file = VAULT_ICON_FILES[vaultKey];
  if (!file) return null;
  return `${VAULT_ICON_BASE_URL.replace(/\/+$/, "")}/${file}`;
};

/** Vault key behind a share-token symbol (e.g. `saveUSDST`), if it is one. */
export const getVaultKeyForSymbol = (symbol: string | null | undefined): string | null =>
  symbol ? SHARE_SYMBOL_TO_VAULT_KEY[symbol.trim().toLowerCase()] ?? null : null;

/**
 * Icon for a held token: vault artwork when the token is a vault share,
 * otherwise `null` so the caller keeps using the token's own image metadata.
 */
export const getVaultIconUrlForSymbol = (symbol: string | null | undefined): string | null =>
  getVaultIconUrl(getVaultKeyForSymbol(symbol));

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
  [SAVE_USDST_VAULT_KEY]: "323f649574f7559907e383ccfd46838762be8f0213d7dc144f14e84ee48b8451.png",
  "eth-carry": "f0ce4f3a905444fc58fa28a558dada3ac300b9f79dd13bd309b0d2e553d77fa5.png",
  "wbtc-carry": "4b048b6b08515fe2f40184944673248fb5c387dfa7b04980b0e1a5792fecb4e0.png",
  "usdc-yield": "cd7402081e448dcbb10ced74cb53ea0259b2205870136a3bd9c8cd05ce9fbcdd.png",
  "goldst-yield": "f67de103ada9df64a9c112e2e88c417c6242a9d46b22e882d1786630714948ec.png",
  "silvst-yield": "3c6fb897f54bafc662df6de95c760a4a36b1de1ae906285e9b6f3746852f2235.png",
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

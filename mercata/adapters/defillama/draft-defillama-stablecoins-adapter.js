const STABLECOINS_ENDPOINT = 'https://YOUR_PUBLIC_STRATO_API_HOST/api/v1/metrics/stablecoins'
const INCLUDED_SYMBOLS = ['USDST', 'USDC', 'USDT']
const EXCLUDED_SYMBOLS = ['SUSDS', 'SYRUPUSDC']
const METHODOLOGY = 'Counts circulating USD-pegged stablecoin supply on STRATO for USDST, USDC, and USDT. Excludes yield-bearing wrappers such as sUSDS and syrupUSDC.'

// Provisional draft:
// DefiLlama's stablecoin submission path is less clearly documented than the TVL
// path. This file captures the endpoint fetch/filter logic that would back a
// stablecoin integration, while the exact final export shape may still need to
// be adjusted to match the repo path requested by DefiLlama reviewers.

async function fetchStratoStablecoins() {
  const response = await fetch(STABLECOINS_ENDPOINT)

  if (!response.ok) {
    throw new Error(`Failed to fetch STRATO stablecoins endpoint: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const assets = Array.isArray(data?.assets) ? data.assets : []

  return assets
    .filter((asset) => INCLUDED_SYMBOLS.includes(String(asset?.symbol || '').toUpperCase()))
    .map((asset) => ({
      address: asset.address,
      name: asset.name,
      symbol: asset.symbol,
      decimals: asset.decimals,
      totalSupply: asset.totalSupply,
      priceUsd: asset.priceUsd,
      totalUsd: asset.totalUsd,
    }))
}

module.exports = {
  chain: 'strato',
  endpoint: STABLECOINS_ENDPOINT,
  methodology: METHODOLOGY,
  includedSymbols: INCLUDED_SYMBOLS,
  excludedSymbols: EXCLUDED_SYMBOLS,
  fetchStratoStablecoins,
}

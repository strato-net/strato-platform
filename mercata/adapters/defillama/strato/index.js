const TVL_ENDPOINT = 'https://app.strato.nexus/api/metrics/tvl'
const METHODOLOGY = 'Counts underlying assets locked in STRATO DeFi contracts across CDP, lending, pools, saveUSDST, safety module, and vaults. Excludes wallet balances, receipt/share tokens, protocol debt, and double counting.'

// TODO: Replace with the actual STRATO launch timestamp/block expected by DefiLlama.
const START = 1775151906

async function tvl(api) {
  const response = await fetch(TVL_ENDPOINT)

  if (!response.ok) {
    throw new Error(`Failed to fetch STRATO TVL endpoint: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const assets = Array.isArray(data?.assets) ? data.assets : []

  for (const asset of assets) {
    if (!asset?.address || asset.amount == null) continue
    api.add(asset.address, asset.amount)
  }
}

module.exports = {
  methodology: METHODOLOGY,
  start: START,
  timetravel: false,
  strato: {
    tvl,
  },
}

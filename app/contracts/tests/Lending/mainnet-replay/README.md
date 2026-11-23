# Lending sunset: mainnet replay

Runs the sunset admin actions in `solid-vm-cli` against the lending stack as it is on upquark:
the code the node serves for every proxy and logic contract, and the state Cirrus holds for them.
`LendingPool.sol` and `SafetyModule.sol` come from this checkout.

```bash
python3 fetch.py     # snapshot state and code into build/ (public endpoints, no credentials)
./run.sh             # generate build/replay/Replay.replay.sol and run it
python3 gasprobe.py  # gas each sunset call uses
```

`SOLID_VM_CLI` selects the binary. It has to be built from a tree with the per-transaction gas
budget (`transactionGas`, 600,000), which is what decides how many accounts one `sunset` call can
carry. The replay sets the network to upquark and the block number to the snapshot's, so the
fork rules in force are mainnet's.

## What it does

1. Deploys every contract from its on-chain source with `create(name, source)`: each `Proxy`,
   AdminRegistry, the Token implementations, TokenFactory, LendingRegistry, CollateralVault,
   LiquidityPool, PriceOracle, FeeCollector, and the LendingPool and SafetyModule that are live.
2. Writes the snapshot into each proxy through a seeder logic contract (`Seeders.sol`), points
   the proxy at its real logic and hands it to the AdminRegistry. Loans, collateral, lendUSDST
   and safetyUSDST sit at their real holders' addresses.
3. Checks that the state reads back through the real logic exactly as the snapshot.
4. Runs the plan: deploys the two implementations, votes the upgrades, the burn and mint, the
   pauses and each `sunset` call from 4 of the 8 admins, the payer's approve and revoke.
5. Checks every balance against an integer model of the pool written independently in
   `gen_replay.py`.

Each test function is one transaction with a transaction's gas, so a call that does not fit on
chain does not fit here. `gen_replay.py` first checks the snapshot for what would stop the sunset
(loans not summing to `totalScaledDebt`, bad debt, a paused or unpriced collateral token, a
missing burn whitelist) and refuses to generate if it finds any.

## Options (`./run.sh [name] [options]`)

| Option | Default | |
|---|---|---|
| `--batch N` | 31 | suppliers per `sunset` call; `0` puts every account in one call |
| `--exec-delay S` | 172800 | seconds between the snapshot and the first sunset vote |
| `--batch-gap S` | 3600 | seconds between two sunset calls |
| `--approve WEI` | debt + margin | payer allowance |
| `--payer-balance WEI` | 5000e18 | USDST the payer starts with |
| `--reimburse WEI` | 107714081647064509748 | burned from `0x…dEaD` and minted to the payer |
| `--skip-pause` | | leave lendUSDST and safetyUSDST unpaused |

`build/replay/<name>.calls.txt` lists the arguments of each `sunset` call.

# Contract Addresses

Contracts created in the genesis block have the **same address on mainnet (upquark) and testnet (helium)**. Contracts deployed later have **different addresses on each network**.

Cirrus and the core API return addresses as 40 hex characters with no `0x`. Add the `0x` prefix when you use an address with JSON-RPC, viem, ethers or a wallet.

!!! note "Sources"
    Genesis addresses are defined in `strato/core/strato-genesis` (`HeliumGenesisBlock.hs` and `Contracts/*.hs`). Per-network addresses are the defaults in `app/backend/src/config/config.ts`. Every address on this page was checked against both public networks through the core API and Cirrus.

For chain IDs and endpoints, see [Networks](../platform/networks.md) or the [Quick Reference](quick-reference.md).

---

## Platform contracts (genesis, both networks)

| Address | Contract | Purpose |
|---|---|---|
| `0000000000000000000000000000000000000100` | MercataGovernance | Validator set and consensus governance. This address is the proxy; the logic contract is at `…00ff`. |
| `0000000000000000000000000000000000000720` | UserRegistry | Maps usernames to on-chain User wallet contracts |
| `0000000000000000000000000000000000dec1de` | Decider | Charges the transaction fee |
| `00000000000000000000000000000000dec1de02` | DeciderState | Fee logic. It burns one voucher, or else sends 0.01 USDST to the FeeCollector. |

## DeFi system contracts (genesis, both networks)

Most of these are `Proxy` contracts. Genesis placed their first implementations at matching `0x11xx` addresses (for example, LendingPool's is `…1105`), but the current implementation may be different. Always call the proxy address.

| Address | Contract | Notes |
|---|---|---|
| `0000000000000000000000000000000000001000` | Mercata | Genesis record of the core component addresses |
| `0000000000000000000000000000000000001001` | RateStrategy | Lending interest rate model |
| `0000000000000000000000000000000000001002` | PriceOracle | Default price oracle (used by lending and CDP) |
| `0000000000000000000000000000000000001003` | CollateralVault | Holds lending collateral |
| `0000000000000000000000000000000000001004` | LiquidityPool | Holds lending liquidity |
| `0000000000000000000000000000000000001005` | LendingPool | Supply collateral, borrow, repay, liquidate |
| `0000000000000000000000000000000000001006` | PoolConfigurator | Lending admin configuration |
| `0000000000000000000000000000000000001007` | LendingRegistry | Points to the lending components |
| `0000000000000000000000000000000000001008` | MercataBridge | Bridge deposits and withdrawals |
| `000000000000000000000000000000000000100a` | PoolFactory | Creates swap pools and lists them |
| `000000000000000000000000000000000000100b` | TokenFactory | Creates tokens and lists them |
| `000000000000000000000000000000000000100c` | AdminRegistry | Admin and multisig governance of the DeFi contracts |
| `000000000000000000000000000000000000100d` | FeeCollector | Receives transaction fees and protocol fees |
| `000000000000000000000000000000000000100e` | Voucher (`VOUCHER`) | Fee vouchers |
| `000000000000000000000000000000000000100f` | lendUSDST | Receipt token for lending liquidity |
| `0000000000000000000000000000000000001011` | CDPEngine | Deposit collateral, mint and repay USDST |
| `0000000000000000000000000000000000001012` | CDPRegistry | Points to the CDP components |
| `0000000000000000000000000000000000001013` | CDPVault | Holds CDP collateral |
| `0000000000000000000000000000000000001014` | CDPReserve | CDP reserve |
| `0000000000000000000000000000000000001015` | SafetyModule | USDST safety module |
| `0000000000000000000000000000000000001016` | safetyUSDST | SafetyModule share token |
| `000000000000000000000000000000000000101f` | RewardsChef | Genesis rewards contract |

### Genesis swap pools

| Pool | LP token | Pair |
|---|---|---|
| `0000000000000000000000000000000000001017` | `0000000000000000000000000000000000001018` | ETH / USDST |
| `0000000000000000000000000000000000001019` | `000000000000000000000000000000000000101a` | WBTC / USDST |
| `000000000000000000000000000000000000101b` | `000000000000000000000000000000000000101c` | GOLDST / USDST |
| `000000000000000000000000000000000000101d` | `000000000000000000000000000000000000101e` | SILVST / USDST |

Other pools were created after genesis. List every pool with the [PoolFactory query](#list-all-swap-pools).

## Genesis tokens (both networks)

All of these use 18 decimals.

| Address | `_symbol` | `_name` |
|---|---|---|
| `937efa7e3a77e20bbdbd7c0d32b6514f368c1010` | USDST | USDST |
| `93fb7295859b2d70199e0a4883b7c320cf874e6c` | ETH | STRATO ETH |
| `7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9` | WBTC | STRATO WBTC |
| `cdc93d30182125e05eec985b631c7c61b3f63ff0` | GOLDST | GOLDST |
| `2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94` | SILVST | SILVST |

!!! warning "Look up tokens by address, not symbol"
    Symbols are not unique. For example, more than one token uses the symbol `GOLDST`. Bridged tokens such as ETH and WBTC have no "ST" suffix.

## Per-network contracts

These contracts were deployed after genesis, so each network has its own address.

| Contract | Mainnet (upquark) | Testnet (helium) |
|---|---|---|
| STRATO token | `2ca3e170e6714282da77815f7864b17f612f5f83` | `8ee9a3391e38176feebf5d43cb2c1d6c4f728b04` |
| Rewards | `4a116cf8cb056036632aef08f7c0df27c720f1c0` | `170147f58738c9f46112a874030420b823901f3b` |
| StratoStaking | `f30a022ce83bed7adeafc286c719388dcc3b3988` | `d6726e06c3c71a3bad80b5eb6925707a31729b81` |
| ValidatorRegistry | `d190674c0923a4646746b298037507bb9fc1057f` | `bfbb75bb6bd0bafa2f5c5b735fe518ade76808dd` |
| StratoNativeBridge | `4d9e9c39180a75091b9c35bbb9064d67c7fdde5a` | `49f69252b00235030a4dcd4c7ef17a64ef346258` |
| StratoNativeCustodyVault | `db967ac5c497e6a2bd6f89036d2b63851760318f` | `8cfe7b576f69260673e9a1a9517137f12a49ed93` |
| PoolV3Factory | `5d630126d908b46bcf8d00bc15e591a459375809` | `e6b6f05a88e649e4102a801aade9a6bae02f352d` |
| PositionManagerV3 | `ce5d96341ba4fede57d7721c5b0e41d283aa7435` | `1bc216225dd4e164ded916cb88a7c09804a881d1` |
| VaultFactory | `55c77951e9cadc73af24ec18881d01fedff1f1f1` | `37b446ec53607a0cdae38c820b838baf240a8b74` |
| SaveUSDSTVault | `22550671fcad04a213697ac7ae4f4366e96446ed` | `ceeb982f671b4ee2b4471e5b49f3126739537f15` |
| DirectMintPSM | `b1efdc86eecfbedf83d0295671214fee451786f3` | `0b30adc5f2d90bada37afa699b75f485f04e7287` |
| MetalForge | `1cc5bad32dc8667878fa7c53cc5cfd6e76fdb113` | `c5ed981b816a626981a5747d125e0e7296b2c7c6` |

---

## Discover addresses on-chain

Registries and factories are the source of truth. Cirrus allows anonymous `GET` reads, so none of these queries need a token. Replace the host with `app.testnet.strato.nexus` for testnet.

### Lending components

```bash
curl -s "https://app.strato.nexus/cirrus/search/BlockApps-LendingRegistry?address=eq.0000000000000000000000000000000000001007&select=lendingPool,collateralVault,liquidityPool,priceOracle"
```

```json
[{"lendingPool":"0000000000000000000000000000000000001005","collateralVault":"0000000000000000000000000000000000001003","liquidityPool":"0000000000000000000000000000000000001004","priceOracle":"0000000000000000000000000000000000001002"}]
```

### CDP components

```bash
curl -s "https://app.strato.nexus/cirrus/search/BlockApps-CDPRegistry?address=eq.0000000000000000000000000000000000001012&select=cdpEngine,cdpVault,cdpReserve,usdst,priceOracle,feeCollector,tokenFactory"
```

### List all swap pools

```bash
curl -s "https://app.strato.nexus/cirrus/search/BlockApps-PoolFactory-allPools?address=eq.000000000000000000000000000000000000100a&select=value"
```

### Find a token

```bash
curl -s "https://app.strato.nexus/cirrus/search/BlockApps-Token?_symbol=eq.USDST&select=address,_name,_symbol,customDecimals"
```

### Check what is deployed at an address

```bash
curl -s "https://app.strato.nexus/strato-api/eth/v1.2/account?address=0000000000000000000000000000000000001005"
```

The response includes `contractName` (for example `Proxy`, `Decider` or `UserRegistry`) and `codeHash`.

---

## Explore contracts

- **Stratoscan** (block explorer): [stratoscan.strato.nexus](https://stratoscan.strato.nexus)
- **STRATO Management Dashboard (SMD)**: `/smd/` on each app host, for example `https://app.testnet.strato.nexus/smd/`

## Contract source

The DeFi contracts are in `app/contracts/concrete` (for example `Lending/LendingPool.sol`, `CDP/CDPEngine.sol`, `Bridge/MercataBridge.sol`, `Pools/Pool.sol`, `Tokens/Token.sol`). The platform contracts are in `strato/core/strato-genesis/resources`.

## Next steps

- [Integration Guide](integration.md): call these contracts
- [Cirrus reference](../reference/cirrus.md): query syntax and table naming
- [Quick Reference](quick-reference.md)

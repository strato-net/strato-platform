# Native Bridge Admin Powers

Internal. Do not publish until the attestation threshold is raised (see [Open items](#open-items-before-exchange-review)): this document names the single key that can mint on Ethereum.

This is the disclosure exchanges and auditors ask for: who can mint, burn, pause, freeze and upgrade STRATO, USDST, GOLDST and SILVST on the STRATO chain and on Ethereum. Every fact below was read from mainnet on **2026-09-14**. Re-run the checks in [Re-verifying](#re-verifying) before sending it anywhere.

## Contract inventory

### STRATO chain (upquark mainnet)

| Contract | Proxy | Logic | Owner |
|---|---|---|---|
| STRATO token | `2ca3e170e6714282da77815f7864b17f612f5f83` | `8b18171fda814e7e1f02cd01f08111abf438d73e` | AdminRegistry |
| USDST token | `937efa7e3a77e20bbdbd7c0d32b6514f368c1010` | `000000000000000000000000000000000000110f` | AdminRegistry |
| GOLDST token | `cdc93d30182125e05eec985b631c7c61b3f63ff0` | `000000000000000000000000000000000000110f` | AdminRegistry |
| SILVST token | `2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94` | `000000000000000000000000000000000000110f` | AdminRegistry |
| StratoNativeBridge | `4d9e9c39180a75091b9c35bbb9064d67c7fdde5a` | `03eccf3c17d6ae4d2a925d7439a2031dac798e51` | AdminRegistry |
| StratoNativeCustodyVault | `db967ac5c497e6a2bd6f89036d2b63851760318f` | `194f7cd0f5c9a02c5e53958c0f88e2e3edd949f6` | AdminRegistry |
| AdminRegistry | `000000000000000000000000000000000000100c` | n/a | itself |

### Ethereum mainnet

| Contract | Proxy | Implementation |
|---|---|---|
| StratoNativeRepresentationBridge | `0x991513a7fb8793fc75955821bbef488f0aa0712f` | `0x7975770ca7382ee35419daea73ccb14397c04af5` |
| STRATO | `0x4c93b9fbf7fd1777ccbcbc538b1d0a8b58fb1ad6` | `0xbbf8921e0974f330989849e366e6c144b2cb55e7` |
| USDST | `0xaebcdbd9f8b1422ab31073d7408c8cad83ca6a8b` | `0x94c9505f9ddd0a4abcd73c58231fa3cbc4b38624` |
| GOLDST | `0xf6c8a66788fddea78eb4654a8b5674b2fe1857cb` | `0xf5cb3aab38dcb3a1bd1040dc490f5c06114200a4` |
| SILVST | `0x5925525658c86d2c3117f79c0c88203cbec812c1` | `0xf5cb3aab38dcb3a1bd1040dc490f5c06114200a4` |
| saveUSDST | `0x319f3f0e1d4e3a501a7747c08de6bb9882eef7e5` | `0xf5cb3aab38dcb3a1bd1040dc490f5c06114200a4` |
| Admin Safe | `0x95b47c329286128d9ee628770b13dd4d795cbf55` | Safe, 2 of 3 |

All implementations are verified on Blockscout, and Sourcify reports an exact match for the bridge and the token implementations. The three token implementations were compiled from identical source; their bytecode differs only because each UUPS implementation embeds its own address. The source matches `app/ethereum/contracts/bridge/` in this repo, and `app/ethereum/.openzeppelin/mainnet.json` records all six proxies.

## Who controls what on the STRATO chain

### AdminRegistry: the owner of everything

- **Admins:** `7630b673862a2807583834908f10192e00c58b00`, `292dd9591f506845ef05a9f3b8116e641cbcb4bb`, `f1ba16a6cfb2a17fb34ad477eaaf0c76eac64f14`.
- **Threshold:** 6000 basis points of the admin count, which is **2 of 3**. No per-function threshold overrides are set.
- **Mechanism:** when anyone other than the owner calls an owner-only function, the call becomes a vote in AdminRegistry. It executes once the threshold is reached, or immediately if the caller is whitelisted for that exact contract and function.
- **Changing the admin set** is itself a 2-of-3 vote.
- **No timelock.** A passed vote executes in the same transaction as the deciding vote.

### Token powers (STRATO, USDST, GOLDST, SILVST)

An AdminRegistry vote can:

- mint any amount to any address;
- burn any amount from **any** address;
- pause and unpause transfers;
- rename the token and change its metadata;
- replace the logic contract behind the proxy, which changes any behavior.

Contracts whitelisted to call a function directly, without a vote:

| Token | Function | Caller |
|---|---|---|
| USDST | mint, burn | MercataBridge `0000000000000000000000000000000000001008` |
| USDST | mint, burn | CDPEngine `0000000000000000000000000000000000001011` |
| USDST | mint, burn | FlashMint `390ba7f7807c97f134f25c8462c65c353e55c177` |
| USDST | mint, burn | DirectMintPSM `b1efdc86eecfbedf83d0295671214fee451786f3` |
| GOLDST, SILVST | mint | MetalForge `1cc5bad32dc8667878fa7c53cc5cfd6e76fdb113` |
| STRATO | transfer, transferFrom while paused | Custody vault `db967ac5…`, StratoStaking `f30a022c…` |
| STRATO | transfer while paused | Wallet `9e9d7087c0f330cefffe7c884f4ff4d32c1cf528` |

STRATO is **paused** today. Only the whitelisted callers above can move it until an AdminRegistry vote unpauses it.

### Native bridge and custody vault

| Role | Holder | Powers |
|---|---|---|
| Owner | AdminRegistry | Add, change or disable routes, set per-token caps, set operator and guardian, unpause, upgrade |
| Bridge operator | `882f3d3a7b97ea24ab5aeae6996a695b26ea9089` | Record, confirm, finalize and abort deposits and withdrawals |
| Guardian | `292dd9591f506845ef05a9f3b8116e641cbcb4bb` | Pause only; unpausing needs the owner |
| Vault bridge | StratoNativeBridge | The only address that can lock and unlock custody balances |
| Vault guardian | AdminRegistry | Pause the vault |

Every route has an instant-withdrawal threshold of zero, so every withdrawal goes through the manual lane.

| Route to Ethereum | Max per withdrawal | Max outstanding | Withdrawals |
|---|---|---|---|
| STRATO | 3,125,000 | 0 | Disabled |
| USDST | 10,000 | 40,000 | Enabled |
| GOLDST | 10 | 7 | Enabled |
| SILVST | 150 | 250 | Enabled |
| saveUSDST | 10,000 | 20,000 | Enabled |

A disabled test route for a token named DUMMY still holds 2,450.4 DUMMY in the vault.

## Who controls what on Ethereum

### Admin Safe

`0x95b47c329286128d9ee628770b13dd4d795cbf55` is a 2-of-3 Safe with owners `0x17085F1887aA05AFf2c1E6526d938d9765FC2e72`, `0x1be6150E8dd00180FA2bf267d765c8491E0BFA96` and `0x5B2bD6B3846EE609c688AC95F19eE1566D211054`. These are the same owners as the deposit bridge custody Safe `0x8c458f866e603335ef179a63a2528f357732f5d5`. There is no timelock.

| Contract | Roles held by the admin Safe |
|---|---|
| Representation bridge | DEFAULT_ADMIN, UPGRADER, MAPPING_ADMIN, ATTESTATION_ADMIN, PAUSER, UNPAUSER |
| All five tokens | DEFAULT_ADMIN, UPGRADER, TRANSFER_ADMIN |

The bridge contract holds BRIDGE_ROLE on all five tokens and is the only minter.

### Minting

`mintRepresentationWithAttestation` has **no caller restriction**. Anyone holding a valid attestation can call it. The contract checks that:

- the attestation is signed by at least `attestationThreshold` registered signers, which is **1**, by signer `0x344c9e7e7d75368142cf522078c3a08ae1faa82c`;
- the source withdrawal has not been minted before;
- the token mapping exists and the route is active;
- the attestation is inside its validity window, at most 7 days.

There is **no per-token or per-period amount cap on Ethereum**. The Safe approval step the relayer uses for manual-lane withdrawals is operational procedure; the contract does not require it. Mints can be stopped by pausing, which the admin Safe controls.

### Transfers, freezes and upgrades

- **Transfer gate:** STRATO has `transfersEnabled = false`; only transfers to or from the bridge work. USDST, GOLDST, SILVST and saveUSDST have transfers enabled. The admin Safe can turn the gate on or off at any time, which exchanges will classify as a freeze capability.
- **Upgrades:** UUPS, executed immediately by the admin Safe.
- **No blacklist, no fee on transfer, no rebasing, no permit.**

## Supply backing

Ethereum supply equals the balance locked in the STRATO custody vault for every live route.

| Token | Ethereum totalSupply | Locked on STRATO chain |
|---|---|---|
| STRATO | 2,132,850.565447583813935590 | 2,132,850.565447583813935590 |
| USDST | 19,914.378023055070009670 | 19,914.378023055070009670 |
| GOLDST | 3.5 | 3.5 |
| SILVST | 151.01 | 151.01 |
| saveUSDST | 0.2 | 0.2 |

The public supply endpoints under `/api/v1/metrics/supply` count these tokens once, on the STRATO chain.

## Open items before exchange review

1. **Raise the attestation threshold.** One key can mint unlimited tokens on Ethereum today, and they can be redeemed against the custody vault. Add independent signers and raise the threshold; consider per-token mint caps in the next bridge upgrade.
2. **Add timelocks** to upgrades and admin actions on both chains, or document why not.
3. **Identify wallet `9e9d7087c0f330cefffe7c884f4ff4d32c1cf528`**, which can move STRATO while it is paused, and remove it after TGE if it is no longer needed.
4. **Unlock STRATO at TGE:** an AdminRegistry vote to unpause STRATO, another to enable STRATO withdrawals with a non-zero outstanding cap, and a Safe transaction to enable transfers on the Ethereum token.
5. **List non-circulating wallets** in `app/backend/src/config/supplyExclusions.ts` once TGE vesting and treasury wallets exist.
6. **Remove the DUMMY test balance** from the custody vault.

## Re-verifying

```bash
export ETH_RPC_URL=https://ethereum-rpc.publicnode.com
BRIDGE=0x991513a7fb8793fc75955821bbef488f0aa0712f
SAFE=0x95b47c329286128d9ee628770b13dd4d795cbf55

cast call $BRIDGE 'attestationThreshold()(uint8)'
cast call $BRIDGE 'attestationSignerCount()(uint8)'
cast call $SAFE 'getThreshold()(uint256)'
cast call $SAFE 'getOwners()(address[])'
cast call 0x4c93b9fbf7fd1777ccbcbc538b1d0a8b58fb1ad6 'transfersEnabled()(bool)'
cast call 0x4c93b9fbf7fd1777ccbcbc538b1d0a8b58fb1ad6 'hasRole(bytes32,address)(bool)' \
  0x915327d54f2c758ad33c35b031b5e89868657ea971cda2b8103c502dc672509c $SAFE
```

```bash
CIRRUS=https://app.strato.nexus/cirrus/search
curl "$CIRRUS/BlockApps-AdminRegistry?address=eq.000000000000000000000000000000000000100c"
curl "$CIRRUS/BlockApps-AdminRegistry-admins?address=eq.000000000000000000000000000000000000100c"
curl "$CIRRUS/BlockApps-AdminRegistry-whitelist?address=eq.000000000000000000000000000000000000100c"
curl "$CIRRUS/BlockApps-StratoNativeBridge-assets?address=eq.4d9e9c39180a75091b9c35bbb9064d67c7fdde5a"
curl "$CIRRUS/BlockApps-StratoNativeBridge-tokenBridgeConfigs?address=eq.4d9e9c39180a75091b9c35bbb9064d67c7fdde5a"
curl "$CIRRUS/BlockApps-StratoNativeCustodyVault-lockedBalance?address=eq.db967ac5c497e6a2bd6f89036d2b63851760318f"
curl "$CIRRUS/BlockApps-Proxy?address=eq.2ca3e170e6714282da77815f7864b17f612f5f83"
```

# Safety & Best Practices

How to use STRATO safely, and the risks the protocol carries.

---

## Protect Your Account

- **Bookmark the official app:** [app.strato.nexus](https://app.strato.nexus) (testnet: [app.testnet.strato.nexus](https://app.testnet.strato.nexus)). Check the URL before signing in.
- **STRATO account sign-in:** your STRATO key is held for you by the STRATO Vault service, so anyone who gets into your login can act as you. Use a strong, unique password and never share it.
- **External wallets** (MetaMask, the STRATO wallet extension, or any wallet you connect to bridge): never share your seed phrase or private key. Consider a hardware wallet for large amounts.
- **Read what you sign.** Check the amount, token and destination in every confirmation dialog.
- **Scams:** the team will never ask for your password, seed phrase or private key, and won't DM you first. Ignore unsolicited links.

---

## Protocol Risks

### Liquidation Risk

CDP vaults (the Borrow page) are liquidated per asset once a vault's collateralization ratio falls below that asset's liquidation ratio, which the app shows as health factor below 1. Any user can then repay part of the debt and take collateral worth that amount **plus a liquidation penalty** (5% to 30%, set per asset). Stability fees raise your debt over time, so health factor falls slowly even when prices don't move.

- Don't mint up to the maximum. Leave room for price drops.
- Check the Portfolio page's warnings and each vault's health factor on **Borrow > Your Vaults**.
- If health factor drops, **deposit collateral** or **repay** before it reaches 1.

Details: [Mint USDST via CDP](guides/mint-cdp.md#liquidation).

### Oracle Risk

Collateral values, health factors and liquidations use prices from the on-chain `PriceOracle` contract. An off-chain oracle service posts those prices, and only authorized accounts can update them.

- If a posted price is wrong or delayed, positions can be liquidated at that price, or fail to be liquidated in time.
- The CDP engine and lending pool use the latest posted price and do not reject old prices.

### Smart Contract Risk

- Contracts can contain bugs. Most protocol contracts sit behind upgradeable proxies, so fixes can be deployed, but the logic behind an address can also change.
- **Security reviews in the repository:** the StablePool contract has an internal security review report ([StablePoolAudit2.md](https://github.com/strato-net/strato-platform/blob/develop/app/contracts/tests/Pool/StablePoolAudit2.md), September 2026). It records all findings as fixed and includes regression tests. The repository contains no third-party audit reports.
- Report vulnerabilities privately to **security@strato.nexus**.

### Admin and Governance Controls

Protocol contracts are owned by `AdminRegistry`, a multi-admin contract. An owner-only action runs once enough admins vote for it (by default 60% of admins; thresholds can be set per function), or when an account the admins have whitelisted for that specific function calls it. Operator services such as the oracle and the bridge relayer use whitelists. Through this contract, admins can:

- change risk parameters (collateral ratios, fees, debt ceilings, emission rates)
- pause assets, pools, the CDP engine, bridge deposits or withdrawals, and tokens
- upgrade proxied contracts
- set oracle and bridge operator accounts

These controls protect users during incidents, but they also mean you trust the admin set.

### Bridge Risk

- The bridge depends on an **off-chain relayer** to verify deposits and execute payouts. There is no on-chain light client.
- Funds on external chains sit in a **Safe multisig** custody wallet, plus an optional hot wallet for small payouts on some chains. Large withdrawals need the Safe's signers to approve.
- Withdrawals can take days and depend on liquidity. Admins can pause the bridge, and in an incident can move in-flight withdrawal escrow to a triage wallet.

See [Bridge Assets](guides/bridge.md#trust-model).

### Liquidity Pool Risk

- **Impermanent loss** when pooled token prices move apart ([Provide Liquidity](guides/liquidity.md#impermanent-loss)).
- **Concentrated positions** stop earning fees once price leaves your range.
- **Paused pools** stop swaps and deposits.

### Stablecoin Risk

USDST is minted against CDP collateral and through the PSM. If liquidations can't cover a vault's debt, the shortfall is recorded as bad debt (**Advanced > Bad Debt**). Stablecoins held in pools or vaults can lose their peg.

---

## Practical Checklist

- [ ] Start with a small amount the first time you use a feature.
- [ ] Keep some USDST or vouchers for fees. Each transaction costs 0.01 USDST or one voucher, even if it reverts.
- [ ] Double-check external addresses before bridging out.
- [ ] Watch health factors when markets move.
- [ ] Save transaction hashes for support requests.

---

## If Something Goes Wrong

- **Account or wallet compromised:** move remaining assets to a wallet you control, change your password, and contact support.
- **Sent to the wrong address:** blockchain transfers can't be reversed.
- **Bridge transfer stuck:** see [Bridge Assets](guides/bridge.md#common-issues), then contact support with transaction details.

When asking for help, include the transaction hash, what you did and any error message. **Never** share your password, seed phrase or private key.

### Official Channels

- **Documentation:** [docs.strato.nexus](https://docs.strato.nexus)
- **Support:** [support.blockapps.net](https://support.blockapps.net)
- **Telegram:** [t.me/strato_net](https://t.me/strato_net)
- **Security reports:** security@strato.nexus

---

## Related Guides

- **[Borrow USDST](guides/borrow.md)**
- **[Mint USDST via CDP](guides/mint-cdp.md)**
- **[Bridge Assets](guides/bridge.md)**
- **[Core Concepts](concepts.md)**

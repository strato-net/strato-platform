## Tokens

Purpose: ERC20-like tokens with metadata, factory, faucet, and access hooks.

Functional summary:
- Standard ERC20 transfers with revert-on-failure semantics; owner‑controlled mint/burn and metadata.

Key contracts:
- Token.sol: ERC20 with custom decimals, metadata, rewards hook, and owner controls.
- TokenFactory.sol: Deploys new Token contracts with initial supply and metadata.
- TokenMetadata.sol: On-chain metadata storage.

Core flows:
- Mint/Burn: Owner-controlled supply changes.
- Transfer: Reverts on invalid states; integrates with RewardsManager in _update.
- Create Token: Factory deploys Token with provided params.

Dev notes:
- ERC20 behavior reverts on failure (never returns false) across transfer/transferFrom.
- `decimals()` returns customDecimals; defaults managed at deployment.



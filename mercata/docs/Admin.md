## Admin

Purpose: Governance and fee administration for the Mercata protocol.

Functional summary:
- Manage admin set (add/remove/swap) via multi-admin voting.
- Gate sensitive actions using per-contract/function whitelists.
- Collect and route protocol fees through `FeeCollector`.

Key contracts:
- AdminRegistry.sol: Multi-admin registry with voting, per-contract function whitelists, and delegated execution.
- FeeCollector.sol: Collects protocol fees and forwards per policy.

Core flows:
- Add/remove/swap admin: proposals voted via AdminRegistry; emits IssueCreated/IssueExecuted.
- Whitelist updates: Admins vote to whitelist users per target contract/function.
- Fee collection: Protocol components transfer fees to FeeCollector.

Dev notes:
- Integrates with tokens/pools via AdminRegistry address; consumers should read whitelist/admin status.
- Events provide an audit trail for governance actions.

Test:
- Verify voting thresholds, whitelist toggles, and event emissions.

Prod:
- Configure initial admins and thresholds at deployment; restrict admin keys and monitor events.



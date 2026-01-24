# API Specifications - Technical Documentation

Implementation-level API specifications with formulas, algorithms, and technical details.

## Available Documents

### [Lending Specification](lending-spec.md)
**Complete Lending Protocol Specification**

Technical specification for the lending protocol including:
- Smart contract methods and parameters
- Mathematical formulas (health factor, exchange rate, utilization)
- Interest rate calculations
- Liquidation mechanics
- Bad debt handling
- SafetyModule integration

**Contains:** Solidity code references, formula derivations, edge cases

**Audience:** Smart contract developers, protocol integrators, auditors

---

### [Lending Pool Overview](lending_pool_overview.md)
**Detailed Lending Mechanics**

In-depth overview of lending pool operations:
- Deposit and withdrawal mechanics
- Borrow and repay flows
- Collateral vault integration
- Interest accrual
- Reserve management

**Audience:** Protocol developers, integration engineers

---

### [Lending API Test Plan](lending_api_test_plan.md)
**QA and Testing Documentation**

Comprehensive test plan for lending functionality:
- Test scenarios and cases
- Expected behaviors
- Edge case handling
- Integration test requirements

**Audience:** QA engineers, test writers, auditors

---

## API Documentation Levels

The platform provides API documentation at different levels:

| Document | Type | Audience | Example |
|----------|------|----------|---------|
| [User Guides](../../guides/borrow.md) | Tutorial | End users | "Click Borrow to get USDST" |
| [App API Reference](../../reference/api.md) | REST API | App developers | "POST /lending/borrow" |
| **This section** | Implementation | Core developers | "debt = scaledDebt × borrowIndex / 1e27" |

## When to Use These Specs

**Use these documents when:**
- Implementing smart contracts that interact with the protocol
- Building backend services that need to understand protocol math
- Auditing smart contract security
- Debugging protocol mechanics
- Writing comprehensive tests
- Validating calculations

**Don't use these documents for:**
- Building frontend applications → Use [App API Reference](../../reference/api.md)
- Learning how to use the platform → Use [User Guides](../../guides/)
- Quick API lookup → Use [Quick Reference](../../build-apps/quick-reference.md)

## Related Documentation

- [Design Documents](../design/) - High-level design specifications
- [Smart Contracts](../architecture/contracts.md) - Contract architecture
- [Interactive API](../../reference/interactive-api.md) - Swagger UI for testing

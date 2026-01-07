# Contributing to STRATO

Guidelines for contributing to the STRATO platform codebase.

---

## Welcome Contributors!

Thank you for your interest in contributing to STRATO! Whether you're fixing a bug, adding a feature, or improving documentation, your contribution is valued.

---

##Before You Start

### 1. Set Up Your Development Environment

Follow the [Setup Guide](setup.md) to get STRATO running locally.

### 2. Understand the Architecture

Read the [Architecture Guide](architecture.md) to understand how components work together.

### 3. Choose Your Area

Pick the area you want to work on:

- **Blockchain Core** - Haskell (`strato/`)
- **Smart Contracts** - Solidity (`mercata/contracts/`)
- **Backend API** - Node.js/TypeScript (`mercata/backend/`)
- **Frontend UI** - React/TypeScript (`mercata/ui/`)
- **Services** - Background services (`mercata/services/`)

---

## Development Workflow

### 1. Find or Create an Issue

**Option A: Work on Existing Issue**

1. Browse [GitHub Issues](https://github.com/blockapps/strato-platform/issues)
2. Look for issues labeled:
   - `good-first-issue` - Great for newcomers
   - `help-wanted` - Community contributions welcome
   - `bug` - Bug fixes
   - `enhancement` - New features
3. Comment on the issue to let others know you're working on it

**Option B: Propose a New Feature**

1. Open a new issue
2. Describe the feature/bug
3. Wait for feedback from maintainers
4. Once approved, start working on it

### 2. Fork and Clone (External Contributors)

If you're not a core team member:

```bash
# Fork the repo on GitHub first
git clone git@github.com:YOUR-USERNAME/strato-platform.git
cd strato-platform

# Add upstream remote
git remote add upstream git@github.com:blockapps/strato-platform.git
```

### 3. Create a Feature Branch

```bash
# Update main
git checkout main
git pull upstream main

# Create feature branch
git checkout -b feature/your-feature-name
```

**Branch Naming Convention:**

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring
- `test/description` - Test improvements

**Examples:**

- `feature/add-liquidation-alerts`
- `fix/lending-pool-health-factor`
- `docs/update-api-examples`

### 4. Make Your Changes

**Component-specific guidelines:**

See the [Architecture Guide](architecture.md) for details on each component's structure and technology stack.

**General guidelines:**

- Write clean, readable code
- Follow existing code style
- Add comments for complex logic
- Update documentation if needed

### 5. Test Your Changes

**Run tests:**

```bash
# Full stack
make test

# Component-specific
cd mercata/contracts && npm test
cd mercata/backend && npm test
cd mercata/ui && npm test
```

**Test locally:**

```bash
./start test_node
# Manually test your changes
./forceWipe
rm -rf test_node/
```

**Ensure:**

- All existing tests pass
- New features have tests
- No regressions introduced

### 6. Commit Your Changes

**Commit Message Format:**

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `style` - Formatting (no code change)
- `refactor` - Code refactoring
- `test` - Adding/updating tests
- `chore` - Build/tooling changes

**Examples:**

```
feat(lending): add liquidation alerts

Add email and webhook notifications when positions approach
liquidation threshold. Users can configure alert levels
in the UI settings.

Closes #123
```

```
fix(cdp): correct stability fee calculation

The rate accumulator was not being updated correctly,
causing incorrect interest accrual. Fixed by updating
the accumulator on every state change.

Fixes #456
```

```
docs(api): update REST API examples

Update all API examples to use the new authentication
flow with OAuth 2.0 tokens.
```

**Commit Best Practices:**

- One logical change per commit
- Write clear, descriptive messages
- Reference issue numbers (`Closes #123`, `Fixes #456`)
- Keep commits atomic (easy to revert if needed)

### 7. Push Your Branch

```bash
git push origin feature/your-feature-name
```

### 8. Open a Pull Request

1. Go to [GitHub](https://github.com/blockapps/strato-platform)
2. Click "New Pull Request"
3. Select your branch
4. Fill out the PR template (see below)
5. Submit

**PR Title Format:**

Same as commit messages: `<type>(<scope>): <subject>`

**PR Description Template:**

```markdown
## Description
Brief description of what this PR does.

## Motivation
Why is this change needed? What problem does it solve?

## Changes
- List of changes made
- Breaking changes (if any)
- New dependencies (if any)

## Testing
How was this tested? Steps to reproduce:
1. Step 1
2. Step 2
3. Expected result

## Checklist
- [ ] Tests pass locally
- [ ] New tests added (if applicable)
- [ ] Documentation updated (if applicable)
- [ ] No breaking changes (or documented)
- [ ] Code follows style guidelines

## Related Issues
Closes #123
Fixes #456
```

---

## Code Style Guidelines

### Haskell (Blockchain Core)

**Style:**

- Use `stylish-haskell` for formatting
- 2-space indentation
- Max line length: 100 characters
- Explicit type signatures
- Descriptive function names

**Example:**

```haskell
-- Good
processBlock :: Block -> StateT BlockchainState IO (Either BlockError ())
processBlock block = do
  validateBlock block
  executeTransactions (blockTransactions block)
  updateState block

-- Bad (no type signature, unclear name)
pb b = do
  validateBlock b
  executeTransactions (blockTransactions b)
  updateState b
```

### Solidity (Smart Contracts)

**Style:**

- Use `prettier-plugin-solidity` for formatting
- 4-space indentation
- Follow [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html)
- Explicit visibility modifiers
- NatSpec comments for public functions

**Example:**

```solidity
// Good
/// @notice Supply collateral to the lending pool
/// @param asset The address of the asset to supply
/// @param amount The amount to supply
/// @return success True if supply was successful
function supplyCollateral(
    address asset,
    uint256 amount
) external returns (bool success) {
    require(amount > 0, "Amount must be greater than 0");
    // ... implementation
}

// Bad (no comments, missing validation)
function supply(address a, uint b) public returns (bool) {
    // ... implementation
}
```

### TypeScript (Backend & Frontend)

**Style:**

- Use ESLint + Prettier
- 2-space indentation
- Max line length: 100 characters
- Explicit types (avoid `any`)
- Descriptive names

**Example:**

```typescript
// Good
async function borrowUSDST(
  user: string,
  asset: string,
  amount: bigint
): Promise<TransactionResult> {
  const healthFactor = await calculateHealthFactor(user);
  if (healthFactor < MIN_HEALTH_FACTOR) {
    throw new Error("Health factor too low");
  }
  // ... implementation
}

// Bad (no types, unclear name)
async function borrow(u, a, amt) {
  // ... implementation
}
```

### General Guidelines

**DRY (Don't Repeat Yourself):**

- Extract common logic into functions
- Use libraries for shared code

**KISS (Keep It Simple, Stupid):**

- Simple solutions over clever ones
- Clear code over comments

**Error Handling:**

- Always handle errors gracefully
- Provide helpful error messages
- Log errors for debugging

**Security:**

- Never commit secrets (API keys, private keys)
- Validate all inputs
- Follow security best practices for your language

---

## Code Review Process

### What to Expect

1. **Automated Checks:** CI/CD will run tests and linters
2. **Maintainer Review:** A core team member will review your code
3. **Feedback:** You may be asked to make changes
4. **Approval:** Once approved, your PR will be merged

### Review Timeline

- **Simple fixes:** 1-2 days
- **Features:** 3-7 days
- **Large changes:** 1-2 weeks

### Addressing Feedback

```bash
# Make requested changes
git add .
git commit -m "Address review feedback"
git push origin feature/your-feature-name
```

**Tips:**

- Respond to all comments
- Ask questions if unclear
- Be open to feedback
- Iterate quickly

---

## Testing Guidelines

### Unit Tests

**What:** Test individual functions/components in isolation

**When:** Every new function/method

**Example (TypeScript):**

```typescript
describe('calculateHealthFactor', () => {
  it('should return correct health factor for safe position', () => {
    const result = calculateHealthFactor(
      BigInt('10000'), // collateral
      BigInt('5000'),  // debt
      8500            // liquidation threshold
    );
    expect(result).toBe(BigInt('17000'));
  });
});
```

### Integration Tests

**What:** Test multiple components working together

**When:** New features involving multiple modules

**Example:**

```typescript
describe('Lending Flow', () => {
  it('should allow supply, borrow, repay, and withdraw', async () => {
    await supplyCollateral(user, 'ETHST', ethers.parseEther('10'));
    await borrow(user, 'USDST', ethers.parseEther('5000'));
    await repay(user, 'USDST', ethers.parseEther('5000'));
    await withdrawCollateral(user, 'ETHST', ethers.parseEther('10'));
  });
});
```

### E2E Tests

**What:** Test full user workflows from UI to blockchain

**When:** Major features, critical flows

**Example:**

```typescript
test('User can borrow USDST', async ({ page }) => {
  await page.goto('http://localhost:3001/borrow');
  await page.click('[data-testid="supply-button"]');
  await page.fill('[data-testid="amount-input"]', '10');
  await page.click('[data-testid="confirm-button"]');
  await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
});
```

---

## Documentation

### When to Update Documentation

**Always update docs when you:**

- Add a new feature
- Change existing behavior
- Fix a bug that was documented incorrectly
- Add/remove API endpoints
- Change configuration options

### What to Update

- **User docs:** `techdocs/` (this site)
- **API docs:** Swagger/OpenAPI specs
- **Code comments:** In-line comments for complex logic
- **README files:** Component-specific README files

---

## Troubleshooting

### Common Issues

**Build fails:**

```bash
# Clean and rebuild
make clean
make
```

**Tests fail:**

```bash
# Wipe and restart
./forceWipe
rm -rf test_node/
./start test_node
make test
```

**Merge conflicts:**

```bash
# Update from main
git checkout main
git pull upstream main
git checkout feature/your-feature-name
git rebase main
# Resolve conflicts
git rebase --continue
git push origin feature/your-feature-name --force
```

---

## Getting Help

**Questions?**

- **Documentation:** [docs.strato.nexus](https://docs.strato.nexus)
- **Support:** [support.blockapps.net](https://support.blockapps.net)
- **Telegram:** [t.me/strato_net](https://t.me/strato_net)

**Stuck on a contribution?**

- Comment on the GitHub issue
- Ask in Telegram
- Reach out to maintainers

---

## Thank You!

Your contributions make STRATO better for everyone. We appreciate your time and effort!

**Next Steps:**

- [Setup](setup.md) - Get started
- [Architecture](architecture.md) - Understand the system


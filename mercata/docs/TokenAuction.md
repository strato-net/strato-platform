# Token Auction Mechanism

## Overview

The TokenAuction contract provides a fair token launch mechanism for new tokens on the Mercata platform. Instead of direct token sales at a fixed price, tokens are distributed through an auction process where the final price is determined by market demand.

## How It Works

### 1. Auction Creation

An administrator creates a token auction by specifying:
- Token details (name, symbol, description, metadata)
- Total tokens available for auction
- Price bounds (minimum and maximum price per token)
- Auction duration

The contract creates the token through the TokenFactory and holds it until the auction completes.

### 2. Commitment Phase

During the auction period, users can commit USDST to purchase tokens:
- Users transfer USDST to the auction contract
- Commitments can be made at any time during the auction period
- Multiple commitments from the same user are accumulated
- All commitments are recorded on-chain

### 3. Price Discovery

After the auction ends, anyone can call `finalizeAuction()` to:
- Calculate the final price: `totalCommitments / tokenAmount`
- Clamp the price to the configured min/max bounds
- Mark the auction as finalized

**Price Calculation Examples:**

```
Scenario 1: High Demand
- Token amount: 1,000,000
- Total commitments: 5,000,000 USDST
- Min price: 1 USDST, Max price: 10 USDST
- Calculated price: 5 USDST per token
- Final price: 5 USDST (within bounds)

Scenario 2: Low Demand
- Token amount: 1,000,000
- Total commitments: 500,000 USDST
- Min price: 1 USDST, Max price: 10 USDST
- Calculated price: 0.5 USDST per token
- Final price: 1 USDST (clamped to minimum)

Scenario 3: Very High Demand
- Token amount: 1,000,000
- Total commitments: 15,000,000 USDST
- Min price: 1 USDST, Max price: 10 USDST
- Calculated price: 15 USDST per token
- Final price: 10 USDST (clamped to maximum)
```

### 4. Token Distribution

After finalization, users can claim their tokens:
- Tokens received = commitment / finalPrice
- Excess USDST is automatically refunded
- Each user can only claim once

**Distribution Example:**

```
User committed: 1,000 USDST
Final price: 5 USDST per token
Tokens received: 1,000 / 5 = 200 tokens
Actual cost: 200 * 5 = 1,000 USDST
Refund: 1,000 - 1,000 = 0 USDST

With price clamping:
User committed: 1,000 USDST
Calculated price would be: 0.5 USDST
Final price (clamped to min): 1 USDST
Tokens received: 1,000 / 1 = 1,000 tokens
Actual cost: 1,000 * 1 = 1,000 USDST
Refund: 1,000 - 1,000 = 0 USDST

With max price clamping:
User committed: 1,000 USDST
Calculated price would be: 15 USDST
Final price (clamped to max): 10 USDST
Tokens received: 1,000 / 10 = 100 tokens
Actual cost: 100 * 10 = 1,000 USDST
Refund: 1,000 - 1,000 = 0 USDST
```

### 5. Proceeds Withdrawal

The auction creator can withdraw the proceeds:
- Proceeds = tokens sold × final price
- Only the actual proceeds are withdrawable
- Excess commitments remain available for user refunds

## Benefits

### Fair Price Discovery
- Market determines the price through supply and demand
- No front-running or price manipulation
- All participants get the same price

### Capital Efficiency
- Users commit what they're willing to spend
- Excess funds are automatically refunded
- No need to guess the right bid amount

### Transparent Process
- All commitments are on-chain
- Price calculation is deterministic
- No hidden allocations or preferential treatment

### Protection Mechanisms
- Minimum price protects token creator
- Maximum price protects buyers from overpaying
- Refund mechanism ensures no loss of funds

## Contract Functions

### Admin Functions

#### `createAuction()`
Creates a new token auction with specified parameters.

#### `cancelAuction()`
Cancels an auction that has no commitments yet.

#### `withdrawProceeds()`
Withdraws auction proceeds after finalization.

### User Functions

#### `commit()`
Commits USDST to an active auction.

#### `claimTokens()`
Claims allocated tokens and refund after auction finalization.

### Public Functions

#### `finalizeAuction()`
Finalizes auction and calculates final price (callable by anyone after auction ends).

### View Functions

#### `getAuction()`
Returns auction details.

#### `getUserCommitment()`
Returns user's commitment details for an auction.

#### `isAuctionActive()`
Checks if an auction is currently accepting commitments.

## Security Considerations

1. **Reentrancy Protection**: All state changes happen before external calls
2. **Access Control**: Only owner can create auctions and withdraw proceeds
3. **Claim Protection**: Users can only claim once, checked via `claimed` flag
4. **Price Bounds**: Min/max prices prevent extreme outcomes
5. **Refund Safety**: Excess funds are always returned to users

## Integration

### Smart Contract Integration

```solidity
// Deploy auction contract
TokenAuction auction = new TokenAuction(owner, usdstAddress, tokenFactoryAddress);

// Create an auction
uint256 auctionId = auction.createAuction(
    "MyToken",
    "A great token",
    images,
    files,
    fileNames,
    "MTK",
    1000000 * 10**18,  // 1M tokens
    18,                // decimals
    1 * 10**18,        // min price: 1 USDST
    10 * 10**18,       // max price: 10 USDST
    7 * 24 * 60 * 60   // 7 days
);

// Users commit
usdstToken.approve(address(auction), amount);
auction.commit(auctionId, amount);

// After auction ends
auction.finalizeAuction(auctionId);

// Users claim
auction.claimTokens(auctionId);
```

### Frontend Integration

See `CreateTokenAuctionForm.tsx` for the admin interface to create auctions.

A corresponding `ParticipateAuctionView.tsx` component should be created for users to:
- View active auctions
- Commit USDST
- Check their commitments
- Claim tokens after finalization

## Future Enhancements

Potential improvements for future versions:

1. **Multiple Auction Types**: Dutch auctions, English auctions, etc.
2. **Vesting Schedules**: Lock tokens with gradual release
3. **Whitelist Support**: Restrict participation to approved addresses
4. **Contribution Limits**: Min/max commitment amounts per user
5. **Partial Refunds**: Return commitments if minimum raise not met
6. **Oracle Integration**: Use external price feeds for bounds
7. **Multi-Token Support**: Accept multiple currencies for commitments

## Related Contracts

- `TokenFactory.sol`: Creates the tokens for auction
- `Token.sol`: The ERC20-compatible token implementation
- `Ownable.sol`: Access control for admin functions

## Events

All significant actions emit events for off-chain tracking:
- `AuctionCreated`: New auction created
- `CommitmentMade`: User commits funds
- `AuctionFinalized`: Auction ends and price calculated
- `TokensClaimed`: User claims their tokens

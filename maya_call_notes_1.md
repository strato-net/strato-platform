- right now you only borrow USDST
- deposit, withdraw

- desposit USDST, then you have mUSDST based on the exchange rate.
- Your mTokens received are an indicator of current liquidity, the interest in the pool grows --> mTokens grows.
- Borrow rate is standard for now, 5%, not like Aave where algorithms for interest rates.
	- some interest in changing this later
- Supply rate is returned to the Liquidity Provider, which is the Borrower interest less the Fee component. Fee goes to platform.
- Pools page is someone who's putting money in.
- But if you want to Borrow, first thing you need to do is supply collateral. Collateral can be any asset (st) that you own
- LTV is loan to value rasion, LT is liquidity threshold, once your loan position goes below LT your position is liquidatable.
- LTV% of the collateral of gold you are eligible to borrow. We fetch these sources from metals.dev / basically standard rates. 15 minutes average.
- Prices are also coming from oracle
- once i borrow, the interest starts accruing. One of the changes we're trying to make is __.
- the interest accrues, say i borrow 75% today, then tomorrow I come back and my amount available to borrow at the smart contract level will factor in the interset you owe up to that point.
- if I wait long enough, i would also be exceeding LT and then be liquidatable
- there is repay page also
- 

Code is at mercata/contracts/concrete/Lending; 7 contracts
- the key contract is LendingPool.sol, which is invoked / has most of the public-facing methods. depositLiquidity, withdrawLiquidity, supply/withdrawCollateral, etc. When withdrawing collateral you mustn't withdraw more than you owe.
- So LendingPool is complicted. 
- We send money to the feeCollector and the rest goes back to the pool.
- LiquidityPool is not directly invoked, it's invoked by LendingPool and it's meant for the token transfers and liquidity management of the pool.
- Similarly CollateralVault manages low-level collateral management.
- When you deploy a new LendingPool the LendingRegistry is involved
- PoolConfigurator configues assets with thresholds etc. Reserve factor tells how much interest goes to pool and how much to fee collector. Its job is to manage the lending pool related parameters
- Oracle is also here, but technically more global; it feeds the market prices accross the platform. UpdatePrices, GetPrices, and authorizedOracles list. 
	- for crypto we have _ and _, for metals we have _ and _
	- we average them out. we have two servers that independently go and grab those prices.
- RateStrategy calculates interest, this is simple for now and may evolve later.

Also if you go to mercata/backend/utils you can see the methods the api can use.

We want to make 3 changes:
1) 
2) 
3) 

Problem we want to solve: interest rate calculated on specific triggers, especially when a user comes to the app. interest is set at the user level; look at the contract and see that the LoanInfo holds the interestOwed at the user level; this is not scalable and is calculated only when a particular user comes and tries to repay/borrow/etc. So we want to solve this problem of how to have a clear indicator at an overall system level of what's going on and when interest should be calculated. REcommendation is to move towards a global borrow index. (RAY, 1e27) proven to alleviate some of the amounts left behind. Being used in Aave. So moving towards a global index will help us and is re-computed any time somebody interacts, not just when a particular user is interacting. Any time there's an activity, the global index is recomputed and affects every user; so we don't need to store these at an individual user level. 

2nd problem we want to solve: want a concept of a system-wide debt ceiling;
- adrian: a number or a leverage?
- Max number of, you cannot exceed system level
- Set in two ways, asset units or USD.
- shouldn't have any impact because when someone tries to borrow, it should throw an error, there shouldn't be much UI changes for this.

3rd is given how we'll accrue the interest, we give the share to the fee collector right now but instead we should let them collect it all at once. 
- Probably not much UI changes either. 

Maya will work on the contract-level changes but she needs help in testing; the touchpoints are more, especially with (1). We're affecting interest, ability to borrow, when they repay, liquidation. So she needs help testing thoroughly.

Secondly, she wants me to look at based on these changes, there might be some backend changes that are needed. For example we remove the interest at the user level, so we need to change that on the backend (or in the contract?) but something needs updated to show the correct numbers.

- not doing Kinked interest

Maya suggest that, Kieren built a test suite for lending, we can expand on it and make sure those flows are not broken. Go through where the backend code is, whrere things tie in between the UI and the backend and the contracts. Think about the scenarios we need to test and how we will test them; maybe a script.
- generally there are minimal tests and prefer speed, but she knows kieren has a bit for lending

- Maya wants to target this Friday to wrap up these key changes, so think of it from that perspective and flag anything not acheivable by Friday.

- Maya will send me a writeup, recommends to feed to AI for further implications

~codecollection.co.sol~

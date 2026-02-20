# Deployment Steps for New Bridged Token with Swap Pool

## Background Info
These instructions are expected to be completed by an Admin, with another admin available for voting to approve issues as needed. An Admin is a member of the `admins` array on the AdminRegistry contract. In order to test and validate the flow, it should first be performed on testnet (helium) before being performed on mainnet (upquark). On testnet, some of the addresses and configurations will likely differ. For example, there may be only one admin on testnet, whose administrative actions will thus be executed immediately upon his sending the transaction, whereas on mainnet there may be multiple admins in the registry, and it will be the admin who reaches quorum whose transaction will cause the function to execute. As such, these deployment instructions should be used to generate a detailed walkthrough for the particular case when it is decided to deploy a new bridged token with a corresponding swap pool, pulling in relevant context and verifying as possible, first for testnet and then for mainnet. Remember that Proxy contracts are being used almost everywhere on STRATO, and the default meaning of a given contract's address should be the Proxy address, not the logic contract address; "the pool address" refers to the address of a proxy contract whose logicContract is a Pool.

## Steps
1. For the token which is to be bridged, acquire the desired quantity on the external chain.

It should sit in a wallet which is compatible with the Bridge In interface of the STRATO application, such as MetaMask. Call this wallet address <y>.

Additionally, decide on a STRATO user account to which the funds will be bridged; call this account's address <x>.

2. Create the ST token on STRATO.

This will be a STRATO wrapped version of the external token, such as WBTCST for WBTC. If any changes are needed to the Admin Create Token UI to make this token creation possible, be sure to use a node with the updated app.

Name: ?
Symbol: ?
Token Image: ?
Description: ?
Total Supply: 0

We have decided recently that symbol should typically be equivalent to name, case-sensitive.
The token image should be a 128x128 PNG.
The initial total supply should be zero here, because all mints will be through the mint-on-bridge wrapping flow.

Vote to approve the issue.

3. Configure the oracle servers (mainnet/testnet according to which deployment is being done) to provide a price feed for the newly created token.

The below example flow notwithstanding, **this is best done immediately after token creation, before activation.** The STRATO address of the newly created token is now known from step 2. If you activate the token before configuring the oracle, the token will appear in the app at $0 price, and any swap pool created later will show a loading spinner instead of a price. The oracle price feed sources should have been identified and prepared in advance (see Required Parameters), so that they can be deployed as soon as the token address is known.

This is typically done by an engineer / ops person. At least 3 sources must be added, and the normal oracle server update process should be followed according to the STRATO Support Doc. Be careful because the STRATO address may be different on mainnet than in testnet.

After configuration, verify the oracle is serving the correct price before proceeding.

4. Set the token status to active using the admin panel Tokens -> Token Status UI.

You can search by token name in the search bar on that tab if it’s sufficiently unique; if there is any question, determine the newly created token address and then search by address. In any case, copy the address of the token; you’ll need it below.

Under the Actions column, click Set, and in the modal, change PENDING to ACTIVE in the dropdown and press Update Token Status to submit.

Vote to approve the issue.

Since the oracle was configured in step 3, the token should appear in the app with the correct price immediately upon activation. Verify the price shows correctly. If it shows $0, resolve the oracle configuration before continuing.

5. Whitelist mercata bridge to mint and burn the newly created token.

In the Admin Panel Vote on Issues tab, click Create New Issue.

Contract address: <AdminRegistry Address> (likely 000000000000000000000000000000000000100c)
Function Name: addWhitelist
_target: <Newly created token address>
_func: mint
_user: <MercataBridge address> (likely 0x1008; be sure to use 0x prefix)

Then do the same with _func: burn

Contract address: <AdminRegistry Address>
Function Name: addWhitelist
_target: <Newly created token address> 
_func: burn
_user: <MercataBridge address>

Vote to approve both of these whitelists.

6. Configure the Deposit Router.

Go to SMD, check MercataBridge Proxy (likely `1008`), and check state variable `chains`, and under the network id corresponding to the external chain where the token you're adding resides (such as "1" for ethereum), find the `"depositRouter"`: "c3be40e5eae865d6d80ec334f009eb1bdd107e1b" and `“custody”` entries. Confirm that the custody address matches the address of the custodial Gnosis Safe on that chain. For instance, `"1":{"custody":"8c458f866e603335ef179a63a2528f357732f5d5"}` means you can find the Safe at https://app.safe.global/home?safe=eth:0x8c458F866e603335ef179A63a2528F357732f5d5
Confirm the deposit router address on the corresponding blockchain explorer.

From the Safe app interface, use New Transaction --> Transaction Builder to call DepositRouter(<depositRouterAddr>).setPermitted(<externalTokenAddr>, true)
and, if a minimum deposit is desired, DepositRouter(<depositRouterAddr>).setMinDepositAmount(<externalTokenAddr>, <N>) where N is expressed in the token’s decimals, such as 1000000 for 1 USDC or 25000000000000000 for 0.025 wETH. As of Feb 19th 2026, minimum deposits are typically 0 (meaning no limit) and thus no need to call the latter.

The Safe may auto-load the proxy ABI (showing only `fallback`), not the implementation ABI. If so, you will need to supply the DepositRouter implementation ABI manually — either from the verified implementation contract on Etherscan or from the repo at `mercata/ethereum/artifacts/contracts/bridge/DepositRouter.sol/DepositRouter.json` (extract the `abi` field).

Simulate the transaction, then Send Batch. Execute the transaction, using quorum to approve.

7. Configure the STRATO-side MercataBridge.

In SMD, do
function setAsset(
        bool enabled, uint256 externalChainId, uint256 externalDecimals, string externalName, string externalSymbol, address externalToken, uint256 maxPerWithdrawal, address stratoToken
    )
MercataBridge(<MercataBridgeAddr>).setAsset(
    enabled: true,
    externalChainId: <id for chain where external token is found>,
    externalDecimals: <decimals for the external token> (this is very important to get right; read its _decimals value from onchain),
    externalName: (typically set to whatever the _name is on the external chain),
    externalSymbol: (typically set to whatever the _symbol is on the external chain),
    externalToken: <externalTokenAddr>,
    maxPerWithdrawal: ? (typically 0, meaning no limit, as of Feb 19th 2026),
    stratoToken: <newly created STRATO token addr>
)

maxPerWithdrawal is expressed in STRATO token units, currently always 1e18, even if the externalDecimals is 6 for instance.

Vote to approve the issue.

8. Check that the bridge now supports bridging in on the Deposit UI and bridging out on the Withdrawals UI.

9. Prepare a quantity of USDST equivalent to the dollar value of the newly created token that is planned to be supplied as initial liquidity to the swap pool.

For instance, if I am supplying 1000 units of a new token worth $20, prepare 20,000 USDST. The account `<x>` should hold at least this much USDST (it can hold more for gas vouchers, etc.).

This USDST should be held in STRATO account <x>.

If it is not already possessed on STRATO, this can be bridged from an external stablecoin using the Easy Savings interface on the Deposit page of the app, ensuring that the "Earn saving rate by offering USDST for lending" checkbox is disabled.

10. Bridge in the desired amount of the external token from <y> MetaMask wallet to <x> on STRATO, where it will be held as the newly created STRATO token.

Confirm success of the deposit.

11. Create the swap pool using the Admin UI:
Token A: <NewlyCreatedTokenAddr>,
Token B: USDST,
isStable: ?

If the swap pool should be stable, such as either keeping a constant value or pegging to a low-volatility, gradually changing token, then isStable should be set to true. For swap pools with a volatile asset paired with USDST, isStable should be set to false.

Vote to approve the issue.

After creation, find the Pool Address (Proxy) and LP Token Address (Proxy):
a. Go to Activity Feed -> Blockchain Events and find the NewPool event containing the pool address.
b. Go to that address in SMD, confirm it is a proxy to a Pool contract.
c. In the pool’s state variables, find the `lpToken` field — this is the LP Token Address (Proxy).

12. Whitelist the swap pool to mint and burn the LP token (remember to use the proxy addrs)
_target: <LP Token Address>
_user: <Pool Address>

Remember to do both mint and burn.
Vote to approve both issues.

13. (ONLY IF NEEDED) Set the peg mode to oracle-based to keep a dynamic stable peg.

If this is a StablePool, but one where the token price is expected to drift slowly over time rather than stay constant (such as a yield-bearing stablecoin), then we'll need to set the peg mode of the oracle to keep a dynamic stable peg.

In SMD, call StablePool(<PoolAddr>).updateRateOracles(<PriceOracle>, <PriceOracle>). The is the PriceOracle proxy is likely 0x1002. Important - remember to use the 0x prefix or the full zero-padding so that numerical addresses are recognized as hexadecimal.

Vote to approve the issue.

14. Provide initial seed liquidity to the Swap Pool.

Be careful, because the exchange rate you set will be the initial exchange rate; nothing is stopping you from setting an unrealistic exchange rate and thereby risking loss of funds.

Sanity check: newToken Amount * newToken Price == USDST Amount

You’ll have to type the USDST amount first, and the new token amount second (it won’t autopopulate with a nonzero value). Don’t use the MAX buttons. Double-check the implied ratio (USDST / newToken) matches the oracle price before confirming.

This should be done by <x>, the STRATO user account who was the recipient of the bridge ins from <y>.

15. Activate the LP token.

While activation is not required for minting (and thus liquidity provision), this is important so that it will show up under the My Pool Participation section of the app, and so that users may transfer the LP tokens amongst one another.

Go to the Token -> Token Status section of the Admin Panel UI, search for <newTokenName>-USDST-LP, and activate it.

Vote to approve the issue

16. Test everything.

Check that Swap is now available. The ratio should be close to the oracle price. Consider trying out a swap to test it.

From a normal user, test bridge in and bridge out, swap, liquidity provision and withdrawal.

Ensure that the new token shows up with a price and balance on the Portfiolio page, and that it contributes to Net Portfolio Value and the historical net worth chart. Click the token name and ensure that the Asset Details page looks good. Ensure that the LP token shows up under My Pool Participation.

## Required parameters
In order to complete these steps, the following values must first be determined:
- External chain (including id and prefix, such as "1" and "eth:")
- External token address
- External token _decimals
- External token _name
- External token _symbol
- STRATO token name
- STRATO token symbol (likely equals name)
- STRATO token description (often one sentence to a short paragraph)
- STRATO token image (128x128 PNG)
- External wallet <y> to acquire external token, compatible such as a MetaMask EOA
- STRATO account <x> to receive the deposit and perform the initial liquidity supply
- Should the swap pool be a StablePool?
- AdminRegistry address (likely 000000000000000000000000000000000000100c)
- MercataBridge address (likely 0000000000000000000000000000000000001008)
- PriceOracle address (likely 0000000000000000000000000000000000001002)
- **Confirmed token/USD price** — the admin must check and confirm the current price of the token being added before deciding how much to acquire. This price determines the initial pool ratio, and an incorrect ratio risks loss of funds.
- How much initial liquidity will be supplied to the swap pool?
  - A certain dollar value of the newly added token should be decided upon
  - An amount of USDST **equivalent to the dollar value** will also be supplied,
    in order to have a reasonable initial exchange rate and
    avoid loss of funds from the initial liquidity supplier.
- minDepositAmount
  - The minimum external token wei that can be deposited through the DepositRouter; often 0
- maxPerWithdrawal
  - The maximum STRATO token wei that can be withdrawn through the MercataBridge; often 0 meaning no maximum
- **Price Oracle feeds for the token (at least 3 reliable sources) — these should be identified and ready to deploy before starting.** The oracle configuration (step 3) requires the STRATO token address from step 2, but the source feeds themselves should be prepared in advance so they can be deployed immediately after the token is created. The engineer/ops person responsible for oracle configuration should be on standby.

Additionally, if there's anything else uncertain, it should be confirmed with the admin before the steps begin.

## Follow-Up Steps
Later, consider steps like adding rewards for the new pool and adding the new pool to the arbitrage bot.

## Example 1: Below is found an example for reference of this flow being implemented on mainnet.

STRATO Mainnet syrupUSDCST Deployment Steps
1. Acquire some syrupUSDC on ethereum. This should go in an account which will be able to bridge in, so ideally an EOA with a MetaMask wallet. The syrupUSDC token information can be found at https://etherscan.io/token/0x80ac24aa929eaf5013f6436cda2a7ba190f5cc0b. We decided to purchase it on an exchange, rather than minting from the MaplePool.

2. Create a token named syrupUSDCST on STRATO mainnet. To reach 11 characters in length through the Admin Create Token UI, consider updating the app node first.
Name: syrupUSDCST
Symbol: syrupUSDCST
Token Image: https://blockappsdev.slack.com/files/U09AHANPD88/F0ADSE3TXU7/syrupusdcst.png
You can download the image file from this slack link. Note that to upload through the Admin Create Token UI, without using any fileserver, the image size should be 128x128.
Description:
syrupUSDCST is a digital asset on STRATO pegged 1:1 to syrupUSDC on Ethereum, allowing holders to bridge their syrupUSDC into STRATO to access DeFi opportunities. syrupUSDC is a yield-bearing stablecoin backed by USDC and deployed into institutional lending strategies, generating onchain yield over time. By holding syrupUSDCST, users retain this native syrupUSDC yield while unlocking additional yield opportunities within the STRATO ecosystem.

Total Supply: 0 (no initial mint)

Vote to approve the issue.


3. Set the token status to active using the admin panel Tokens -> Token Status UI. You can search for “syrup” in the search bar on that tab. While you’re at it, copy the address of the token; you’ll need it below. Vote to approve the issue.

4. Whitelist mercata bridge to mint and burn syrupUSDCST.
Contract address: 000000000000000000000000000000000000100c
Function Name: addWhitelist
_target: c6c3e9881665d53ae8c222e24ca7a8d069aa56ca 
_func: mint
_user: 0x1008 (MercataBridge address)

Then do the same with _func: burn

Vote to approve both of these whitelists.

5. Configure the Deposit Router. Go to SMD, check 0x1008 the MercataBridge Proxy, and check state variable chains, and under 1 (ethereum), find "depositRouter": "c3be40e5eae865d6d80ec334f009eb1bdd107e1b", “custody”: ”8c458f866e603335ef179a63a2528f357732f5d5”.
From the gnosis Safe https://app.safe.global/home?safe=eth:0x8c458F866e603335ef179A63a2528F357732f5d5, call DepositRouter(0xC3be40e5EAE865D6d80EC334f009Eb1BDd107e1b).setPermitted(0x80ac24aA929eaF5013f6436cdA2a7ba190f5Cc0b, true)
and DepositRouter(0xC3be40e5EAE865D6d80EC334f009Eb1BDd107e1b).setMinDepositAmount(0x80ac24aA929eaF5013f6436cdA2a7ba190f5Cc0b, 1000000)
for 1 syrupUSDC minimum deposit. (Increase minimum deposit as desired)
Here, the deposit router address comes from the bridge configuration and the address in the parameter is the address of syrupUSDC on Ethereum.
To get the ABI if it’s not automatically loaded, you can copy from https://etherscan.io/address/0xd88e26a0c76396d5a043e2e1b9570a8b3236e3c7#code the implementation address; scroll down to the ABI near the bottom and copy into the SAFE.
Simulate the transaction, then Send Batch. Execute the transaction, using quorum to approve.

6. Configure the STRATO-side MercataBridge.
In SMD, do
MercataBridge(0x1008).setAsset(true, 1, 6, Syrup USDC, syrupUSDC, 0x80ac24aA929eaF5013f6436cdA2a7ba190f5Cc0b, 0, <syrupUSDCST address here>)

Vote to approve the issue.

7. Check that the bridge now supports syrupUSDC → syrupUSDCST on the Deposit / Bridge In UI and syrupUSDCST --> syrupUSDC on the Withdrawals UI.

8. Bridge in 5k USDC → USDST from <y> MetaMask wallet on Ethereum to <x> on STRATO; or, have <x> already holding the desired 5k USDST on STRATO.

9. Bridge in ~$5,000 worth of syrupUSDC (~4,350 syrupUSDC) from <y> MetaMask wallet to <x> on STRATO.

10. Create the stable swap pool using the Admin UI:
Token A syrupUSDCST, Token B USDST, isStable true

Vote to approve the issue.

11. Configure the mainnet oracle servers to provide a price feed for syrupUSDC. Added CoinGecko, CoinMarketCap, and Alchemy. Be careful because the STRATO address may be different than in testnet. After this, the price should show in the app.

12. Whitelist the swap pool to mint and burn the LP token (remember to use the proxy addrs)
_target: <LP Token Address>  (a049efb1a3417801b3dd3877dd566aa24b95b3a0 probably)
_user: <Pool Address> (5888fbe6d6774c1d5788a7b631fc2a2fe88c44c6 probably)

Remember to do both mint and burn.
Vote to approve both issues.

13. Set the peg mode to oracle-based to keep a dynamic stable peg. In SMD, call StablePool(5888fbe6d6774c1d5788a7b631fc2a2fe88c44c6).updateRateOracles(0x1002, 0x1002) where 0x1002 is the PriceOracle proxy.
Vote to approve the issue.

14. Provide initial seed liquidity to the Swap Pool (notice in the screenshot that I made a mistake on the initial ratio; be sure to check the oracle price). Type the USDST amount first, and the syrupUSDC amount second (it won’t autopopulate with a nonzero value)

This should be done by <x>, the STRATO user account who was the recipient of the bridge ins from the Safe.

15. Check that Swap is now available. The ratio should be close to the oracle price, unlike what’s shown below from testnet:
Consider trying out a swap to test it.
From a normal user, test bridge in and bridge out, swap, liquidity provision and withdrawal.

16. Activate the syrupUSDCST-USDST-LP token.
While activation is not required for minting (and thus liquidity provision), this is important so that it will show up under the My Pool Participation section of the app, and so that users may transfer the LP tokens amongst one another.
Go to the Token -> Token Status section of the Admin Panel UI, search for syrupUSDCST-USDST-LP, and activate it.
Vote to approve the issue


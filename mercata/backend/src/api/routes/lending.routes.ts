import { Router } from "express";
import authHandler from "../middleware/authHandler";
import LendingController from "../controllers/lending.controller";
import SafetyController from "../controllers/safety.controller";

const router = Router();

/**
 * @openapi
 * /lending/pools:
 *   get:
 *     summary: Retrieve lending pool registry data
 *     tags: [Lending]
 *     parameters:
 *       - name: select
 *         in: query
 *         required: false
 *         description: Optional field selection forwarded to Cirrus
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         required: false
 *         description: Maximum number of pools to return
 *         schema:
 *           type: string
 *       - name: offset
 *         in: query
 *         required: false
 *         description: Number of records to skip
 *         schema:
 *           type: string
 *       - name: order
 *         in: query
 *         required: false
 *         description: Sort order clause
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lending pool details
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/pools", authHandler.authorizeRequest(true), LendingController.get);

/**
 * @openapi
 * /lending/loans/borrow-max:
 *   post:
 *     summary: Borrow the maximum available USDST
 *     tags: [Lending]
 *     responses:
 *       200:
 *         description: Borrow transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/loans/borrow-max", authHandler.authorizeRequest(), LendingController.borrowMax);

/**
 * @openapi
 * /lending/collateral/withdraw-max:
 *   post:
 *     summary: Withdraw the maximum collateral for an asset
 *     tags: [Lending]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *             properties:
 *               asset:
 *                 type: string
 *                 description: Collateral token address
 *     responses:
 *       200:
 *         description: Withdrawal transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/collateral/withdraw-max", authHandler.authorizeRequest(), LendingController.withdrawCollateralMax);

/**
 * @openapi
 * /lending/collateral:
 *   get:
 *     summary: View supplied collateral and balances
 *     tags: [Lending]
 *     responses:
 *       200:
 *         description: Collateral summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *   post:
 *     summary: Supply collateral to the lending pool
 *     tags: [Lending]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *               - amount
 *             properties:
 *               asset:
 *                 type: string
 *               amount:
 *                 type: string
 *                 description: Amount of collateral to supply (decimal string)
 *     responses:
 *       200:
 *         description: Supply transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *   delete:
 *     summary: Withdraw supplied collateral
 *     tags: [Lending]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *               - amount
 *             properties:
 *               asset:
 *                 type: string
 *               amount:
 *                 type: string
 *                 description: Amount of collateral to withdraw (decimal string)
 *     responses:
 *       200:
 *         description: Withdrawal transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/collateral", authHandler.authorizeRequest(), LendingController.getCollateralAndBalance);
router.post("/collateral", authHandler.authorizeRequest(), LendingController.supplyCollateral);
router.delete("/collateral", authHandler.authorizeRequest(), LendingController.withdrawCollateral);

/**
 * @openapi
 * /lending/liquidity:
 *   get:
 *     summary: Fetch wallet liquidity and balances
 *     tags: [Lending]
 *     responses:
 *       200:
 *         description: Liquidity summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/liquidity", authHandler.authorizeRequest(true), LendingController.getLiquidityAndBalance);

/**
 * @openapi
 * /lending/loans:
 *   get:
 *     summary: Retrieve current loans
 *     tags: [Lending]
 *     responses:
 *       200:
 *         description: Loan summary
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 *   post:
 *     summary: Borrow USDST from the pool
 *     tags: [Lending]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: string
 *                 description: USDST amount to borrow (decimal string)
 *     responses:
 *       200:
 *         description: Borrow transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *   patch:
 *     summary: Repay a portion of outstanding debt
 *     tags: [Lending]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: string
 *                 description: USDST amount to repay (decimal string)
 *     responses:
 *       200:
 *         description: Repayment transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/loans", authHandler.authorizeRequest(), LendingController.getLoans);
router.post("/loans", authHandler.authorizeRequest(), LendingController.borrow);
router.patch("/loans", authHandler.authorizeRequest(), LendingController.repay);

/**
 * @openapi
 * /lending/pools/liquidity:
 *   post:
 *     summary: Deposit liquidity into the lending pool
 *     tags: [Lending]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - stakeMToken
 *             properties:
 *               amount:
 *                 type: string
 *                 description: Liquidity amount to deposit (decimal string)
 *               stakeMToken:
 *                 type: boolean
 *                 description: Whether to automatically stake the resulting mTokens
 *     responses:
 *       200:
 *         description: Deposit transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *   delete:
 *     summary: Withdraw liquidity from the lending pool
 *     tags: [Lending]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - includeStakedMToken
 *             properties:
 *               amount:
 *                 type: string
 *                 description: Liquidity amount to withdraw (decimal string)
 *               includeStakedMToken:
 *                 type: boolean
 *                 description: Whether to include staked mTokens in the withdrawal
 *     responses:
 *       200:
 *         description: Withdrawal transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/pools/liquidity", authHandler.authorizeRequest(), LendingController.depositLiquidity);
router.delete("/pools/liquidity", authHandler.authorizeRequest(), LendingController.withdrawLiquidity);

/**
 * @openapi
 * /lending/pools/withdraw-all:
 *   post:
 *     summary: Withdraw all available pool liquidity
 *     tags: [Lending]
 *     responses:
 *       200:
 *         description: Withdrawal transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/pools/withdraw-all", authHandler.authorizeRequest(), LendingController.withdrawLiquidityAll);

/**
 * @openapi
 * /lending/loans/repay-all:
 *   post:
 *     summary: Repay all active loans
 *     tags: [Lending]
 *     responses:
 *       200:
 *         description: Repayment transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/loans/repay-all", authHandler.authorizeRequest(), LendingController.repayAll);

/**
 * @openapi
 * /lending/liquidate:
 *   get:
 *     summary: List loans currently liquidatable
 *     tags: [Lending]
 *     responses:
 *       200:
 *         description: Liquidatable loan details
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/liquidate", authHandler.authorizeRequest(), LendingController.listLiquidatable);

/**
 * @openapi
 * /lending/liquidate/near-unhealthy:
 *   get:
 *     summary: List loans near the unhealthy threshold
 *     tags: [Lending]
 *     parameters:
 *       - name: margin
 *         in: query
 *         required: false
 *         description: Optional custom health-factor margin (defaults to 0.2)
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: Near-unhealthy loan details
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/liquidate/near-unhealthy", authHandler.authorizeRequest(), LendingController.listNearUnhealthy);

/**
 * @openapi
 * /lending/liquidate/{id}:
 *   post:
 *     summary: Execute a liquidation against a loan
 *     tags: [Lending]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Loan identifier
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - collateralAsset
 *             properties:
 *               collateralAsset:
 *                 type: string
 *                 description: Collateral asset address to seize
 *               repayAmount:
 *                 oneOf:
 *                   - type: string
 *                   - type: number
 *                 description: Amount of debt to repay ("ALL" to cover full debt)
 *               minCollateralOut:
 *                 oneOf:
 *                   - type: string
 *                   - type: number
 *                 description: Minimum collateral amount to receive (slippage protection, defaults to 0)
 *     responses:
 *       200:
 *         description: Liquidation transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/liquidate/:id", authHandler.authorizeRequest(), LendingController.executeLiquidation);

/**
 * @openapi
 * /lending/liquidations/{id}:
 *   post:
 *     summary: Execute a liquidation (legacy endpoint)
 *     tags: [Lending]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Loan identifier
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - collateralAsset
 *             properties:
 *               collateralAsset:
 *                 type: string
 *               repayAmount:
 *                 oneOf:
 *                   - type: string
 *                   - type: number
 *                 description: Amount of debt to repay ("ALL" to cover full debt)
 *               minCollateralOut:
 *                 oneOf:
 *                   - type: string
 *                   - type: number
 *                 description: Minimum collateral amount to receive (slippage protection, defaults to 0)
 *     responses:
 *       200:
 *         description: Liquidation transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/liquidations/:id", authHandler.authorizeRequest(), LendingController.executeLiquidation);

/**
 * @openapi
 * /lending/admin/configure-asset:
 *   post:
 *     summary: Configure lending asset parameters (admin)
 *     tags: [Lending]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *               - ltv
 *               - liquidationThreshold
 *               - liquidationBonus
 *               - interestRate
 *               - reserveFactor
 *               - perSecondFactorRAY
 *             properties:
 *               asset:
 *                 type: string
 *               ltv:
 *                 type: integer
 *               liquidationThreshold:
 *                 type: integer
 *               liquidationBonus:
 *                 type: integer
 *               interestRate:
 *                 type: integer
 *               reserveFactor:
 *                 type: integer
 *               perSecondFactorRAY:
 *                 type: string
 *                 description: Ray-formatted per-second interest factor (>= 1e27)
 *     responses:
 *       200:
 *         description: Configuration transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/admin/configure-asset", authHandler.authorizeRequest(), LendingController.configureAsset);

/**
 * @openapi
 * /lending/admin/sweep-reserves:
 *   post:
 *     summary: Sweep protocol reserves (admin)
 *     tags: [Lending]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: string
 *                 description: Reserve amount to sweep (decimal string)
 *     responses:
 *       200:
 *         description: Sweep transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/admin/sweep-reserves", authHandler.authorizeRequest(), LendingController.sweepReserves);

/**
 * @openapi
 * /lending/admin/set-debt-ceilings:
 *   post:
 *     summary: Set global and per-asset debt ceilings (admin)
 *     tags: [Lending]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - assetUnits
 *               - usdValue
 *             properties:
 *               assetUnits:
 *                 type: string
 *                 description: Debt ceiling measured in asset units (decimal string)
 *               usdValue:
 *                 type: string
 *                 description: Debt ceiling measured in USD value (decimal string)
 *     responses:
 *       200:
 *         description: Debt ceiling transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/admin/set-debt-ceilings", authHandler.authorizeRequest(), LendingController.setDebtCeilings);

/**
 * @openapi
 * /lending/admin/pause:
 *   post:
 *     summary: Pause the lending pool (admin)
 *     tags: [Lending]
 *     responses:
 *       200:
 *         description: Pause transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/admin/pause", authHandler.authorizeRequest(), LendingController.pausePool);

/**
 * @openapi
 * /lending/admin/unpause:
 *   post:
 *     summary: Unpause the lending pool (admin)
 *     tags: [Lending]
 *     responses:
 *       200:
 *         description: Unpause transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/admin/unpause", authHandler.authorizeRequest(), LendingController.unpausePool);

/**
 * @openapi
 * /lending/safety/info:
 *   get:
 *     summary: Retrieve safety module balances and state
 *     tags: [Lending]
 *     responses:
 *       200:
 *         description: Safety module information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.get("/safety/info", authHandler.authorizeRequest(true), SafetyController.getInfo);

/**
 * @openapi
 * /lending/safety/stake:
 *   post:
 *     summary: Stake USDST into the safety module
 *     tags: [Lending]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - stakeSToken
 *             properties:
 *               amount:
 *                 type: string
 *                 description: Amount of USDST to stake (decimal string)
 *               stakeSToken:
 *                 type: boolean
 *                 description: Whether to immediately stake the received sUSDST
 *     responses:
 *       200:
 *         description: Stake transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/safety/stake", authHandler.authorizeRequest(), SafetyController.stake);

/**
 * @openapi
 * /lending/safety/cooldown:
 *   post:
 *     summary: Start the safety module cooldown
 *     tags: [Lending]
 *     responses:
 *       200:
 *         description: Cooldown transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/safety/cooldown", authHandler.authorizeRequest(), SafetyController.startCooldown);

/**
 * @openapi
 * /lending/safety/redeem:
 *   post:
 *     summary: Redeem sUSDST shares from the safety module
 *     tags: [Lending]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sharesAmount
 *               - includeStakedSToken
 *             properties:
 *               sharesAmount:
 *                 type: string
 *                 description: Amount of sUSDST to redeem (decimal string)
 *               includeStakedSToken:
 *                 type: boolean
 *                 description: Whether to include staked sUSDST when redeeming
 *     responses:
 *       200:
 *         description: Redemption transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/safety/redeem", authHandler.authorizeRequest(), SafetyController.redeem);

/**
 * @openapi
 * /lending/safety/redeem-all:
 *   post:
 *     summary: Redeem all sUSDST shares
 *     tags: [Lending]
 *     responses:
 *       200:
 *         description: Redemption transaction payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
router.post("/safety/redeem-all", authHandler.authorizeRequest(), SafetyController.redeemAll);

/**
 * @openapi
 * /lending/interest:
 *   get:
 *     summary: Get interest accrued for lending pool for multiple time periods
 *     tags: [Lending]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Interest accrued for daily, weekly, monthly, YTD, and all-time periods
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalDailyInterestUSD:
 *                   type: string
 *                   description: Total daily interest accrued in USD (18 decimals)
 *                 totalWeeklyInterestUSD:
 *                   type: string
 *                   description: Total weekly interest accrued in USD (18 decimals)
 *                 totalMonthlyInterestUSD:
 *                   type: string
 *                   description: Total monthly interest accrued in USD (18 decimals)
 *                 totalYtdInterestUSD:
 *                   type: string
 *                   description: Total year-to-date interest accrued in USD (18 decimals)
 *                 totalAllTimeInterestUSD:
 *                   type: string
 *                   description: Total all-time interest accrued in USD (18 decimals)
 *                 borrowableAsset:
 *                   type: object
 *                   properties:
 *                     asset:
 *                       type: string
 *                       description: Borrowable asset contract address
 *                     symbol:
 *                       type: string
 *                       description: Asset symbol (e.g., USDST)
 *                     totalDebtUSD:
 *                       type: string
 *                       description: Total debt in USD for this asset (18 decimals)
 *                     annualRatePercent:
 *                       type: number
 *                       description: Annual interest rate as percentage
 *                     dailyInterestUSD:
 *                       type: string
 *                       description: Daily interest accrued in USD (18 decimals)
 *                     weeklyInterestUSD:
 *                       type: string
 *                       description: Weekly interest accrued in USD (18 decimals)
 *                     monthlyInterestUSD:
 *                       type: string
 *                       description: Monthly interest accrued in USD (18 decimals)
 *                     ytdInterestUSD:
 *                       type: string
 *                       description: Year-to-date interest accrued in USD (18 decimals)
 *                     allTimeInterestUSD:
 *                       type: string
 *                       description: All-time interest accrued in USD (18 decimals)
 */
router.get("/interest", authHandler.authorizeRequest(true), LendingController.getInterestAccrued);

export default router;

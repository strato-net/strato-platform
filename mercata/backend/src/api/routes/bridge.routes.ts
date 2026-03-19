import { Router } from "express";
import authHandler from "../middleware/authHandler";
import BridgeController from "../controllers/bridge.controller";

const router = Router();

/**
 * @openapi
 * /bridge/requestWithdrawal:
 *   post:
 *     summary: Submit a withdrawal request
 *     tags: [Bridge]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - externalChainId
 *               - externalToken
 *               - stratoToken
 *               - stratoTokenAmount
 *               - externalRecipient
 *             properties:
 *               externalChainId:
 *                 type: string
 *                 description: Destination chain identifier (numeric string)
 *               stratoToken:
 *                 type: string
 *                 description: STRATO token contract address to withdraw
 *               externalToken:
 *                 type: string
 *                 description: External chain token contract address (or zero/native address mapping)
 *               stratoTokenAmount:
 *                 type: string
 *                 description: Amount of the STRATO token to withdraw (decimal string)
 *               externalRecipient:
 *                 type: string
 *                 description: Recipient address on the external chain
 *     responses:
 *       200:
 *         description: Withdrawal transaction submitted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                     hash:
 *                       type: string
 *                     message:
 *                       type: string
 */
router.post("/requestWithdrawal", authHandler.authorizeRequest(), BridgeController.requestWithdrawal);

/**
 * @openapi
 * /bridge/requestDepositAction:
 *   post:
 *     summary: "Request a post-deposit action (auto-save to lending pool, auto-forge metal, etc.)"
 *     tags: [Bridge]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - externalChainId
 *               - externalTxHash
 *               - action
 *             properties:
 *               externalChainId:
 *                 type: string
 *                 description: External chain identifier (numeric string)
 *               externalTxHash:
 *                 type: string
 *                 description: External transaction hash
 *               action:
 *                 type: number
 *                 description: "Deposit action type (1 = AUTO_SAVE, 2 = AUTO_FORGE)"
 *               targetToken:
 *                 type: string
 *                 description: "Action-specific target token address (e.g. metal token for AUTO_FORGE, omit for AUTO_SAVE)"
 *     responses:
 *       200:
 *         description: Deposit action request submitted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                     hash:
 *                       type: string
 */
router.post("/requestDepositAction", authHandler.authorizeRequest(), BridgeController.requestDepositAction);

/**
 * @openapi
 * /bridge/depositActions:
 *   get:
 *     summary: "List available post-deposit actions (earn, forge metal) with oracle prices"
 *     tags: [Bridge]
 *     responses:
 *       200:
 *         description: List of virtual deposit action routes
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   stratoToken:
 *                     type: string
 *                   stratoTokenSymbol:
 *                     type: string
 *                   depositAction:
 *                     type: number
 *                     description: "1 = AUTO_SAVE, 2 = AUTO_FORGE"
 *                   routeType:
 *                     type: string
 *                     description: "earn | forge"
 *                   oraclePrice:
 *                     type: string
 *                     description: WAD-scaled oracle price for the output token
 */
router.get("/depositActions", authHandler.authorizeRequest(), BridgeController.getDepositActions);

/**
 * @openapi
 * /bridge/bridgeableTokens/{chainId}:
 *   get:
 *     summary: List enabled bridge routes for a chain
 *     tags: [Bridge]
 *     parameters:
 *       - name: chainId
 *         in: path
 *         required: true
 *         description: Destination chain identifier (numeric string)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Available enabled bridge routes for the chain
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   isDefaultRoute:
 *                     type: boolean
 *                   enabled:
 *                     type: boolean
 *                   stratoToken:
 *                     type: string
 *                   stratoTokenName:
 *                     type: string
 *                   stratoTokenSymbol:
 *                     type: string
 *                   externalToken:
 *                     type: string
 *                   externalName:
 *                     type: string
 *                   externalSymbol:
 *                     type: string
 *                   externalChainId:
 *                     type: string
 */
router.get("/bridgeableTokens/:chainId", authHandler.authorizeRequest(false), BridgeController.getBridgeableTokens);

/**
 * @openapi
 * /bridge/networkConfigs:
 *   get:
 *     summary: Fetch enabled bridge networks
 *     tags: [Bridge]
 *     responses:
 *       200:
 *         description: Enabled network configurations
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   externalChainId:
 *                     type: string
 *                   chainInfo:
 *                     type: object
 *                     additionalProperties: true
 */
router.get("/networkConfigs", authHandler.authorizeRequest(false), BridgeController.getNetworkConfigs);

/**
 * @openapi
 * /bridge/transactions/{type}:
 *   get:
 *     summary: Retrieve bridge transaction history
 *     tags: [Bridge]
 *     parameters:
 *       - name: type
 *         in: path
 *         required: true
 *         description: Transaction direction to query
 *         schema:
 *           type: string
 *           enum: [withdrawal, deposit]
 *       - name: limit
 *         in: query
 *         required: false
 *         description: Maximum number of records to return
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
 *         description: Sort order clause (e.g. block_timestamp.desc)
 *         schema:
 *           type: string
 *       - name: stratoToken
 *         in: query
 *         required: false
 *         description: Filter results by STRATO token address
 *         schema:
 *           type: string
 *       - name: externalChainId
 *         in: query
 *         required: false
 *         description: Filter results by external chain identifier
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated transaction records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *                 totalCount:
 *                   type: integer
 */
router.get("/transactions/:type", authHandler.authorizeRequest(), BridgeController.getTransactions);

/**
 * @openapi
 * /bridge/withdrawalSummary:
 *   get:
 *     summary: Get withdrawal summary statistics for the authenticated user
 *     tags: [Bridge]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Withdrawal summary statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalWithdrawn30d:
 *                   type: string
 *                   description: Total withdrawn in last 30 days in wei (string format)
 *                 pendingWithdrawals:
 *                   type: number
 *                   description: Count of pending withdrawals
 *                 availableToWithdraw:
 *                   type: string
 *                   description: Available balance to withdraw in wei (string format)
 */
router.get("/withdrawalSummary", authHandler.authorizeRequest(), BridgeController.getWithdrawalSummary);

export default router;

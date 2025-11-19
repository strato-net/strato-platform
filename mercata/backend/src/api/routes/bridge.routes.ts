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
 *               stratoTokenAmount:
 *                 type: string
 *                 description: Amount of the STRATO token to withdraw (decimal string)
 *               externalRecipient:
 *                 type: string
 *                 description: Recipient address on the external chain
 *               targetStratoToken:
 *                 type: string
 *                 description: Optional STRATO token address to mint on redemption
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

// TODO openapi comment
router.post("/requestAutoSave", authHandler.authorizeRequest(), BridgeController.requestAutoSave);

/**
 * @openapi
 * /bridge/bridgeableTokens/{chainId}:
 *   get:
 *     summary: List tokens that can withdraw to a chain
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
 *         description: Available bridgeable assets
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
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
 * /bridge/redeemableTokens/{chainId}:
 *   get:
 *     summary: List tokens eligible for redemption
 *     tags: [Bridge]
 *     parameters:
 *       - name: chainId
 *         in: path
 *         required: true
 *         description: External chain identifier (numeric string)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tokens that can be redeemed on the target chain
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
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
router.get("/redeemableTokens/:chainId", authHandler.authorizeRequest(false), BridgeController.getRedeemableTokens);

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

export default router;

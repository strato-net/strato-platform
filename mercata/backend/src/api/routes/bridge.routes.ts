import { Router } from "express";
import authHandler from "../middleware/authHandler";
import BridgeController from "../controllers/bridge.controller";

const router = Router();
const walletAuth = authHandler.authorizeRequest({ allowWalletAuth: true });

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
router.post("/requestWithdrawal", walletAuth, BridgeController.requestWithdrawal);

/**
 * @openapi
 * /bridge/withdrawalProof/{txHash}:
 *   get:
 *     summary: "Fetch the inclusion proof for a previously-submitted requestWithdrawalProof tx"
 *     tags: [Bridge]
 *     parameters:
 *       - in: path
 *         name: txHash
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: WithdrawalProof bytes ready to drive an external-chain claim
 *       404:
 *         description: No proof available (tx not finalized, no Withdrawal log, or pre-fork)
 */
router.get("/withdrawalProof/:txHash", authHandler.authorizeRequest(), BridgeController.getWithdrawalProof);

/**
 * @openapi
 * /bridge/withdrawalProof/byBlock/{chainId}/{blockNumber}/{seq}:
 *   get:
 *     summary: "Lookup a Withdrawal proof by (chainId, block, seq) for the catch-up flow"
 *     tags: [Bridge]
 *     parameters:
 *       - in: path
 *         name: chainId
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: blockNumber
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: seq
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: WithdrawalProof for the requested seq
 *       404:
 *         description: No matching Withdrawal log in that block
 */
router.get(
  "/withdrawalProof/byBlock/:chainId/:blockNumber/:seq",
  authHandler.authorizeRequest(),
  BridgeController.getWithdrawalProofForSeq,
);

/**
 * @openapi
 * /bridge/anchorInputs/{chainId}/{txHash}:
 *   get:
 *     summary: "Build EthLightClient.anchorBlockHeader inputs for a deposit"
 *     description: >
 *       Trustless bridge-in step 1. Resolves the deposit's block on the source
 *       chain, fetches the live LightClientFinalityUpdate, and assembles the
 *       header / sync-aggregate / EPH / executionBranch JSON the user wallet
 *       submits to EthLightClient.anchorBlockHeader on STRATO.
 *     tags: [Bridge]
 *     parameters:
 *       - in: path
 *         name: chainId
 *         required: true
 *         description: Source chain identifier (numeric string, e.g. "11155111" for Sepolia)
 *         schema: { type: string }
 *       - in: path
 *         name: txHash
 *         required: true
 *         description: Deposit transaction hash on the source chain
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: AnchorInputs ready to submit
 *       425:
 *         description: Deposit not yet finalized; UI should retry after finality lag
 *       409:
 *         description: Deposit older than the live finalized head (parent-chain anchoring not yet supported)
 */
router.get(
  "/anchorInputs/:chainId/:txHash",
  authHandler.authorizeRequest(),
  BridgeController.getAnchorInputs,
);

/**
 * @openapi
 * /bridge/baseAnchorInputs/{chainId}/{txHash}:
 *   get:
 *     summary: "Build BaseLightClient.anchorBaseBlockViaCannon inputs (OP-Stack Cannon path)"
 *     description: >
 *       Trustless bridge-in step 1 for Base. Locates a DisputeGameCreated
 *       event on L1 whose rootClaim matches the deposit block's outputRoot,
 *       and returns the receipts-MPT proof + Base header RLP +
 *       withdrawalStorageRoot the user submits to anchorBaseBlockViaCannon
 *       on STRATO. Also bundles the L1 anchor inputs the frontend uses
 *       to first anchor the L1 block on EthLightClient.
 *     tags: [Bridge]
 *     parameters:
 *       - in: path
 *         name: chainId
 *         required: true
 *         description: Source L2 chain id (8453 = Base mainnet, 84532 = Base Sepolia)
 *         schema: { type: string }
 *       - in: path
 *         name: txHash
 *         required: true
 *         description: Deposit tx hash on the source L2
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: BaseAnchorInputs ready to submit
 *       400:
 *         description: Unsupported L2 chain
 *       409:
 *         description: Deposit older than the live finalized L1 head
 *       425:
 *         description: No matching DisputeGameCreated yet (or L1 not finalized)
 */
router.get(
  "/baseAnchorInputs/:chainId/:txHash",
  authHandler.authorizeRequest(),
  BridgeController.getBaseAnchorInputs,
);

/**
 * @openapi
 * /bridge/baseAnchorChainInputs/{chainId}/{txHash}:
 *   get:
 *     summary: "Build BaseLightClient.anchorBaseBlockChainViaCannon inputs"
 *     description: >
 *       Trustless bridge-in for Base (Cannon, parent-chain). Locates a
 *       DisputeGameCreated whose claimed L2 block covers the deposit
 *       block, fetches Base headers from the anchor down to the
 *       deposit, and returns the bundle the user submits to
 *       anchorBaseBlockChainViaCannon. Use this when no DGC matches
 *       the deposit block exactly (typical for fresh deposits) —
 *       which is most of the time.
 *     tags: [Bridge]
 *     parameters:
 *       - in: path
 *         name: chainId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: txHash
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: BaseAnchorChainInputs ready to submit
 *       400:
 *         description: Unsupported L2 chain
 *       409:
 *         description: Deposit older than the live finalized L1 head
 *       425:
 *         description: No covering dispute game (or L1 not finalized)
 */
router.get(
  "/baseAnchorChainInputs/:chainId/:txHash",
  authHandler.authorizeRequest(),
  BridgeController.getBaseAnchorChainInputs,
);

/**
 * @openapi
 * /bridge/claimInputs/{chainId}/{txHash}:
 *   get:
 *     summary: "Build EthBridgeIn.claim inputs (MPT receipts proof) for a deposit"
 *     description: >
 *       Trustless bridge-in step 2. Reconstructs the deposit block's receipts
 *       trie, locates the DepositRouted log identified by `depositRoutedSig`,
 *       and returns the receiptValueBytes + MPT proof the user wallet submits
 *       to EthBridgeIn.claim on STRATO. Caller must have already anchored the
 *       block via /bridge/anchorInputs + on-chain anchorBlockHeader.
 *     tags: [Bridge]
 *     parameters:
 *       - in: path
 *         name: chainId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: txHash
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: depositRoutedSig
 *         required: true
 *         description: keccak256 of the DepositRouted event signature, as hex
 *         schema: { type: string, pattern: "^0x[0-9a-fA-F]{64}$" }
 *     responses:
 *       200:
 *         description: ClaimInputs ready to submit
 *       404:
 *         description: No DepositRouted log found in the receipt
 */
router.get(
  "/claimInputs/:chainId/:txHash",
  authHandler.authorizeRequest(),
  BridgeController.getClaimInputs,
);

/**
 * @openapi
 * /bridge/trustlessConfig/{chainId}:
 *   get:
 *     summary: "On-chain deployment metadata for the trustless bridge-in path"
 *     description: >
 *       Returns per-source-chain deployment metadata: bridge-in
 *       address, light-client address, DepositRouted event sig hash,
 *       and (for OP-Stack/Cannon chains) the L1 EthLightClient the
 *       BaseLightClient wraps. Read live from cirrus.
 *     tags: [Bridge]
 *     parameters:
 *       - in: path
 *         name: chainId
 *         required: true
 *         description: Source chain identifier (1 = Ethereum, 11155111 = Sepolia, 8453 = Base, 84532 = Base Sepolia)
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Trustless deployment config
 *       400:
 *         description: chainId not supported by trustless path
 *       503:
 *         description: Trustless path disabled for that chain (no bridge-in registered)
 */
router.get("/trustlessConfig/:chainId", walletAuth, BridgeController.getTrustlessConfig);

/**
 * @openapi
 * /bridge/configuredChains:
 *   get:
 *     summary: "List source chains registered for the trustless bridge-in path"
 *     description: >
 *       Returns every chainId with a non-zero MercataBridge.bridgeIns[chainId]
 *       entry, hydrated with its bridgeIn / lightClient / depositRoutedSig
 *       (and l1LightClient for Base flavor). Drives the chain-selector
 *       buttons on the claim modal.
 *     tags: [Bridge]
 *     responses:
 *       200:
 *         description: Configured chains
 */
router.get("/configuredChains", walletAuth, BridgeController.getConfiguredChains);

/**
 * @openapi
 * /bridge/finalizedHead/{chainId}:
 *   get:
 *     summary: "Latest beacon-finalized EL block on the source chain"
 *     description: >
 *       Returns {blockNumber, timestamp, flavor}. UI polls this
 *       every few seconds to determine which pending deposits are
 *       ready to claim (deposit.blockNumber ≤ blockNumber).
 *     tags: [Bridge]
 *     parameters:
 *       - in: path
 *         name: chainId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Finalized head
 *       400:
 *         description: chainId not supported
 *       503:
 *         description: Trustless path disabled
 */
router.get("/finalizedHead/:chainId", walletAuth, BridgeController.getFinalizedHead);

/**
 * @openapi
 * /bridge/pendingDeposits/{chainId}:
 *   get:
 *     summary: "Unclaimed DepositRouted logs for the user's wallets"
 *     description: >
 *       Scans recent DepositRouted events from the chain's depositRouter
 *       filtered to logs whose stratoRecipient ∈ wallets, drops entries
 *       already in EthBridgeIn.processed, and returns the remainder
 *       newest-first.
 *     tags: [Bridge]
 *     parameters:
 *       - in: path
 *         name: chainId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: wallets
 *         required: true
 *         description: One or more recipient wallet addresses (repeat or comma-separated)
 *         schema:
 *           type: array
 *           items: { type: string }
 *     responses:
 *       200:
 *         description: Pending deposits for the requested wallets
 *       400:
 *         description: Missing wallets or unsupported chain
 *       503:
 *         description: Trustless path disabled
 */
router.get("/pendingDeposits/:chainId", walletAuth, BridgeController.getPendingDeposits);

/**
 * @openapi
 * /bridge/trustlessClaim:
 *   post:
 *     summary: "Submit a trustless bridge-in claim (anchor + claim batch)"
 *     description: >
 *       End-to-end orchestrator for the trustless bridge-in flow.
 *       Builds the proof inputs, optionally skips anchorBlockHeader
 *       when the block is already on-chain, and submits the resulting
 *       STRATO tx batch via the standard wallet-signing pipeline.
 *     tags: [Bridge]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [externalChainId, externalTxHash]
 *             properties:
 *               externalChainId:
 *                 type: string
 *                 description: Source chain identifier (numeric string, e.g. "11155111")
 *               externalTxHash:
 *                 type: string
 *                 description: Deposit transaction hash on the source chain
 *               assignment:
 *                 type: object
 *                 description: Optional ClaimAssignment for the LP fast-finality path
 *                 properties:
 *                   depositKey: { type: string }
 *                   newRecipient: { type: string }
 *                   deadline: { type: string }
 *                   v: { type: integer }
 *                   r: { type: string }
 *                   s: { type: string }
 *     responses:
 *       200:
 *         description: Claim submitted (or unsigned envelopes ready for wallet signing)
 *       404:
 *         description: No DepositRouted log found in the receipt
 *       409:
 *         description: Deposit older than the live finalized head
 *       425:
 *         description: Deposit not yet finalized; UI should retry
 *       503:
 *         description: Trustless path disabled
 */
router.post("/trustlessClaim", walletAuth, BridgeController.trustlessClaim);

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
router.post("/requestDepositAction", walletAuth, BridgeController.requestDepositAction);

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

import { Router } from "express";
import authHandler from "../middleware/authHandler";
import NFTsController from "../controllers/nfts.controller";

const router = Router();
const walletAuth = authHandler.authorizeRequest({ allowWalletAuth: true });

/**
 * @openapi
 * /nfts/owned:
 *   get:
 *     summary: List all NFTs owned by the signed-in user, aggregated across registered NFT sources
 *     tags: [NFTs]
 *     responses:
 *       200:
 *         description: Owned NFTs (kind, collection, tokenId, tokenURI)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 additionalProperties: true
 */
router.get("/owned", authHandler.authorizeRequest(), NFTsController.getOwned);

/**
 * @openapi
 * /nfts:
 *   get:
 *     summary: List NFT collections
 *     tags: [NFTs]
 *     parameters:
 *       - name: status
 *         in: query
 *         required: false
 *         description: Optional Cirrus status filter (e.g. eq.2 for ACTIVE)
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: NFT collection list
 */
// Collection creation and minting are performed on-chain directly (admin calls the
// NFTFactory / NFT contract), not through the app — no create/mint write routes here.
router.get("/", authHandler.authorizeRequest(true), NFTsController.getAll);

/**
 * @openapi
 * /nfts/{address}:
 *   get:
 *     summary: Get an NFT collection with a paginated list of its items
 *     tags: [NFTs]
 *     parameters:
 *       - name: address
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: limit
 *         in: query
 *         schema:
 *           type: string
 *       - name: offset
 *         in: query
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Collection detail with items
 *       404:
 *         description: Collection not found
 */
router.get("/:address", authHandler.authorizeRequest(true), NFTsController.get);

/**
 * @openapi
 * /nfts/{address}/tokens/{tokenId}:
 *   get:
 *     summary: Get a single NFT (owner, tokenURI, approved address)
 *     tags: [NFTs]
 *     responses:
 *       200:
 *         description: NFT item
 *       404:
 *         description: NFT not found
 */
router.get("/:address/tokens/:tokenId", authHandler.authorizeRequest(true), NFTsController.getItem);

/**
 * @openapi
 * /nfts/{address}/transfer:
 *   post:
 *     summary: Transfer an owned NFT to another account
 *     tags: [NFTs]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               to:
 *                 type: string
 *               tokenId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction result
 */
router.post("/:address/transfer", walletAuth, NFTsController.transfer);

/**
 * @openapi
 * /nfts/{address}/burn:
 *   post:
 *     summary: Burn an owned NFT (holder or approved operator, canonical ERC721Burnable semantics)
 *     tags: [NFTs]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tokenId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction result
 */
router.post("/:address/burn", walletAuth, NFTsController.burn);

export default router;

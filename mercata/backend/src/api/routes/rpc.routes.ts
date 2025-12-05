import { Router } from "express";
import RpcController from "../controllers/rpc.controller";

const router = Router();

/**
 * @openapi
 * /rpc/{chainId}:
 *   post:
 *     summary: Proxy a request to an RPC endpoint
 *     tags: [RPC]
 *     parameters:
 *       - name: chainId
 *         in: path
 *         required: true
 *         description: The chain ID; e.g. 1 for Ethereum mainnet, 11155111 for Sepolia
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: The response from the RPC endpoint
 */
router.post("/:chainId", RpcController.proxy);

export default router;


import { Router } from "express";
import authHandler from "../middleware/authHandler";
import VestingController from "../controllers/vesting.controller";

const router = Router();

// GET is a safe method, so authorizeRequest() already resolves req.address from
// X-Wallet-Address for a connected-wallet guest (same as staking's GET /info).
router.get("/", authHandler.authorizeRequest(), VestingController.getVestings);
router.post("/claim", authHandler.authorizeRequest({ allowWalletAuth: true }), VestingController.claim);

export default router;

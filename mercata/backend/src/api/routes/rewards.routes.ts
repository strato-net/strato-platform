import { Router } from "express";
import authHandler from "../middleware/authHandler";
import RewardsChefController from "../controllers/rewardsChef.controller";

const router = Router();

// ----- RewardsChef Information -----
// Get all pools
router.get("/pools", authHandler.authorizeRequest(true), RewardsChefController.getPools);

// Get total pending CATA rewards across all pools for a user
router.get("/pending/total", authHandler.authorizeRequest(), RewardsChefController.getTotalPendingRewards);

// Get pending CATA rewards for a user in a specific pool
router.get("/pending", authHandler.authorizeRequest(), RewardsChefController.getPendingRewards);

export default router;

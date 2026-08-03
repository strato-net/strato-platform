import { Router } from "express";
import authHandler from "../middleware/authHandler";
import StakingController from "../controllers/staking.controller";

const router = Router();
const walletAuth = authHandler.authorizeRequest({ allowWalletAuth: true });

router.get("/info", authHandler.authorizeRequest(), StakingController.getInfo);
router.get("/info/public", authHandler.authorizeRequest(true), StakingController.getPublicInfo);

router.post("/stake", walletAuth, StakingController.stake);
router.post("/move", walletAuth, StakingController.moveStake);
router.post("/unstake", walletAuth, StakingController.unstake);
router.post("/claim", walletAuth, StakingController.claim);
router.post("/operator/claim", walletAuth, StakingController.claimOperatorRewards);
router.post("/withdraw-unbonded", walletAuth, StakingController.withdrawUnbonded);

router.post("/commission", walletAuth, StakingController.setCommission);
router.post("/self-bond", walletAuth, StakingController.selfBond);
router.post("/self-unbond", walletAuth, StakingController.unbondSelf);

router.post("/rewards/deposit", walletAuth, StakingController.depositRewards);
router.post("/admin/operators", walletAuth, StakingController.addOperator);
router.delete("/admin/operators", walletAuth, StakingController.removeOperator);
router.patch("/admin/operators/commission", walletAuth, StakingController.setOperatorCommission);
router.post("/admin/reward-schedule", walletAuth, StakingController.startRewardSchedule);
router.post("/admin/reward-schedule/stop", walletAuth, StakingController.stopRewardSchedule);
router.patch("/admin/params", walletAuth, StakingController.setParams);

export default router;

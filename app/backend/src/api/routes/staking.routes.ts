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

// proposer fees (USDST)
router.post("/claim-fees", walletAuth, StakingController.claimFees);
router.post("/operator/claim-fees", walletAuth, StakingController.claimOperatorFees);

// validator lifecycle
router.post("/register", walletAuth, StakingController.register);
router.post("/profile", walletAuth, StakingController.updateProfile);
router.post("/activate", walletAuth, StakingController.activate);
router.post("/reconcile", walletAuth, StakingController.reconcile);
router.post("/sync", walletAuth, StakingController.sync);
router.post("/exit", walletAuth, StakingController.requestExit);
router.post("/exit/cancel", walletAuth, StakingController.cancelExit);

// admin (owner votes)
router.patch("/admin/operators/validator-address", walletAuth, StakingController.setValidatorAddress);
router.patch("/admin/validator-params", walletAuth, StakingController.setValidatorParams);
router.patch("/admin/set-params", walletAuth, StakingController.setSetParams);
router.patch("/admin/governance", walletAuth, StakingController.setGovernance);
router.post("/admin/recover-fees", walletAuth, StakingController.recoverUnattributedFees);
router.patch("/admin/emergency-kicker", walletAuth, StakingController.setEmergencyKicker);
router.patch("/admin/governance/staking-contract", walletAuth, StakingController.setGovernanceStakingContract);
router.patch("/admin/governance/hard-cap", walletAuth, StakingController.setGovernanceHardCap);
router.post("/admin/operators", walletAuth, StakingController.addOperator);
router.delete("/admin/operators", walletAuth, StakingController.removeOperator);
router.patch("/admin/operators/commission", walletAuth, StakingController.setOperatorCommission);
router.post("/admin/reward-schedule", walletAuth, StakingController.startRewardSchedule);
router.post("/admin/reward-schedule/stop", walletAuth, StakingController.stopRewardSchedule);
router.patch("/admin/params", walletAuth, StakingController.setParams);

export default router;

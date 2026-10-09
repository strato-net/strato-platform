import { Router } from "express";
import authHandler from "../middleware/authHandler";
import StakingController from "../controllers/staking.controller";

const router = Router();
const walletAuth = authHandler.authorizeRequest({ allowWalletAuth: true });

router.get("/info", authHandler.authorizeRequest(), StakingController.getInfo);
router.get("/info/public", authHandler.authorizeRequest(true), StakingController.getPublicInfo);
/**
 * @openapi
 * /staking/authorization-digest:
 *   get:
 *     summary: Digest a validator key must sign to authorize an operator
 *     description: >
 *       keccak256(abi.encodePacked("STRATO validator operator authorization", registry, validator,
 *       operator, authorizationNonce[validator])). Read fresh on every call: the nonce moves each time
 *       a consent is consumed, and a signature over a stale digest is rejected by the registry.
 *       Validator hosts normally produce the signature with `strato-authorize-operator`, which
 *       computes the same digest locally.
 *     tags: [Staking]
 *     parameters:
 *       - in: query
 *         name: validator
 *         required: true
 *         schema: { type: string }
 *         description: Validator (node key) address, with or without 0x
 *       - in: query
 *         name: operator
 *         required: true
 *         schema: { type: string }
 *         description: Operator account the validator key is authorizing
 *     responses:
 *       200:
 *         description: The digest and its inputs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 registry:  { type: string, description: ValidatorRegistry proxy address }
 *                 validator: { type: string }
 *                 operator:  { type: string }
 *                 nonce:     { type: string, description: authorizationNonce[validator], decimal string }
 *                 digest:    { type: string, description: 0x-prefixed 32-byte hash to sign raw (no message prefix) }
 */
router.get("/authorization-digest", authHandler.authorizeRequest(), StakingController.getAuthorizationDigest);

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
/**
 * @openapi
 * /staking/register:
 *   post:
 *     summary: List a validator with the connected account as its operator
 *     description: >
 *       Calls ValidatorRegistry.register. The connected account becomes the operator and pays the
 *       fee. Needs the validator key's consent to this account (see /staking/authorization-digest)
 *       unless the connected account is the validator itself.
 *     tags: [Staking]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [validator, commissionBps]
 *             properties:
 *               validator:
 *                 type: string
 *                 description: Validator (node key) address, with or without 0x
 *               commissionBps:
 *                 type: string
 *                 description: Operator commission in basis points (0..maxCommissionBps)
 *               name:        { type: string }
 *               description: { type: string }
 *               metadataURI: { type: string }
 *               signature:
 *                 type: string
 *                 pattern: '^(0x)?[0-9a-fA-F]{130}$'
 *                 description: >
 *                   The validator key's secp256k1 signature over the authorization digest, serialized
 *                   as 0x + r (64 hex) + s (64 hex) + v (2 hex): 132 characters. v is accepted as
 *                   00/01 (recovery id, what the vault returns) or 1b/1c (27/28). Exactly what
 *                   `strato-authorize-operator` prints. Omit it only when the connected account IS
 *                   the validator, in which case the transaction itself is the consent.
 *     responses:
 *       200:
 *         description: Transaction result ({ status, hash }); external-wallet callers receive the unsigned transaction to sign
 *       400:
 *         description: Invalid body, or signature missing/malformed ({ error })
 *       409:
 *         description: Registry rejected it. Authorization invalid or already used, or validator already listed ({ error: { message, status } })
 */
router.post("/register", walletAuth, StakingController.register);
/**
 * @openapi
 * /staking/operator:
 *   post:
 *     summary: Take over a listed validator as its operator
 *     description: >
 *       Calls ValidatorRegistry.setOperator(validator, connectedAccount, v, r, s). The connected
 *       account becomes the operator and pays the fee. The outgoing operator's self-bond is queued
 *       for unbonding and the validator may leave the consensus set until the new operator
 *       self-bonds and activates. Anyone holding a valid signature can submit it, so the change is
 *       effectively authorized the moment the validator key signs.
 *     tags: [Staking]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [validator]
 *             properties:
 *               validator:
 *                 type: string
 *                 description: Validator (node key) address, with or without 0x
 *               signature:
 *                 type: string
 *                 pattern: '^(0x)?[0-9a-fA-F]{130}$'
 *                 description: >
 *                   The validator key's secp256k1 signature over the authorization digest, serialized
 *                   as 0x + r (64 hex) + s (64 hex) + v (2 hex): 132 characters. v is accepted as
 *                   00/01 (recovery id, what the vault returns) or 1b/1c (27/28). Exactly what
 *                   `strato-authorize-operator` prints. Omit it only when the connected account IS
 *                   the validator, in which case the transaction itself is the consent.
 *     responses:
 *       200:
 *         description: Transaction result plus the record as it now stands
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, description: Success, Failure or unsigned (external wallets) }
 *                 hash:   { type: string }
 *                 validator:
 *                   type: object
 *                   description: Omitted for unsigned responses or if the read-back fails
 *                   properties:
 *                     address:     { type: string }
 *                     status:      { type: integer, description: 0 Missing, 1 Registered, 2 Active, 3 Kicked }
 *                     isValidator: { type: boolean, description: In the consensus set }
 *                     operator:    { type: string }
 *       400:
 *         description: Invalid body, or signature missing/malformed ({ error })
 *       404:
 *         description: Validator not listed ({ error: { message, status } })
 *       409:
 *         description: Authorization invalid or already used, or this account already operates the validator ({ error: { message, status } })
 */
router.post("/operator", walletAuth, StakingController.setOperator);
router.post("/profile", walletAuth, StakingController.updateProfile);
router.post("/activate", walletAuth, StakingController.activate);
router.post("/reconcile", walletAuth, StakingController.reconcile);
router.post("/sync", walletAuth, StakingController.sync);
router.post("/exit", walletAuth, StakingController.requestExit);
router.post("/exit/cancel", walletAuth, StakingController.cancelExit);

// admin (owner votes)
router.patch("/admin/operators/validator-address", walletAuth, StakingController.setValidatorAddress);
router.patch("/admin/operators/operator", walletAuth, StakingController.setValidatorOperator);
router.patch("/admin/validator-params", walletAuth, StakingController.setValidatorParams);
router.patch("/admin/self-bond-grace", walletAuth, StakingController.setSelfBondGrace);
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

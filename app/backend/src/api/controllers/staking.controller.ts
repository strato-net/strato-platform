import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  activateStratoOperator,
  addStratoOperator,
  cancelStratoExit,
  claimStratoFeeRewards,
  claimStratoOperatorFeeRewards,
  claimStratoOperatorRewards,
  claimStratoRewards,
  depositStratoRewards,
  getStratoAuthorizationDigest,
  getStratoStakingInfo,
  moveStratoStake,
  reconcileStratoValidatorSet,
  recoverStratoUnattributedFees,
  registerStratoOperator,
  removeStratoOperator,
  requestStratoExit,
  selfBondStrato,
  setGovernanceHardCap,
  setGovernanceStakingContract,
  setStratoCommission,
  setStratoEmergencyKicker,
  setStratoGovernance,
  setStratoSelfBondGrace,
  setStratoSetParams,
  setStratoStakingParams,
  setStratoOperatorCommission,
  setStratoValidatorAddress,
  setStratoValidatorOperator,
  setStratoValidatorParams,
  stakeStrato,
  startStratoRewardSchedule,
  stopStratoRewardSchedule,
  syncStratoValidator,
  unbondSelfStrato,
  unstakeStrato,
  updateStratoOperatorProfile,
  withdrawStratoUnbonded,
} from "../services/staking.service";

// Amounts must be integer values. Strings are the canonical form; plain JSON
// numbers are accepted only within Number.MAX_SAFE_INTEGER — beyond that,
// JSON.parse has already rounded the value, so the request is rejected rather
// than building a transaction for a silently corrupted amount.
const parseAmount = (value: unknown): bigint | null => {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? BigInt(value) : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return null;
};

const isPositiveAmount = (value: unknown): boolean => {
  const parsed = parseAmount(value ?? "0");
  return parsed !== null && parsed > 0n;
};

const isNonNegativeAmount = (value: unknown): boolean => {
  const parsed = parseAmount(value);
  return parsed !== null && parsed >= 0n;
};

const isAddressLike = (value: unknown): boolean =>
  typeof value === "string" && /^(0x)?[0-9a-fA-F]{40}$/.test(value.trim());

// Optional in the body (v1 calls act on the sender's own record), well-formed if present;
// the service requires it where the contract does.
const isOptionalAddress = (value: unknown): boolean => value === undefined || isAddressLike(value);

const isOptionalSignature = (value: unknown): boolean =>
  value === undefined || value === null || value === ""
  || (typeof value === "string" && /^(0x)?[0-9a-fA-F]{130}$/.test(value.trim()));

const parseOptionalBoolean = (value: unknown): boolean | null => {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
};

// Staking records are keyed by validator. Bodies from clients written against the
// operator-keyed API still name them `operator`; those keys are accepted as aliases.
const pick = (...values: unknown[]): any =>
  values.find((value) => value !== undefined && value !== null && value !== "");

class StakingController {
  static async getInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const info = await getStratoStakingInfo(req.accessToken, req.address as string | undefined);
      res.status(RestStatus.OK).json(info);
    } catch (error) {
      next(error);
    }
  }

  static async getPublicInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const info = await getStratoStakingInfo(req.accessToken);
      res.status(RestStatus.OK).json(info);
    } catch (error) {
      next(error);
    }
  }

  // What a validator key signs to authorize an operator (register / setOperator).
  static async getAuthorizationDigest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validator = req.query?.validator;
      const operator = pick(req.query?.operator, req.address);
      if (!isAddressLike(validator) || !isAddressLike(operator)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid authorization digest request" });
        return;
      }

      const result = await getStratoAuthorizationDigest(req.accessToken, String(validator), String(operator));
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async stake(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const delegations = (Array.isArray(req.body?.delegations) ? req.body.delegations : [])
        .map((item: any) => ({ validator: pick(item?.validator, item?.operator), amount: item?.amount }));
      if (!delegations.length || delegations.some((item: any) => !isAddressLike(item.validator) || !isPositiveAmount(item.amount))) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid delegations" });
        return;
      }

      const result = await stakeStrato(req.accessToken, req.address as string, delegations);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async moveStake(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body || {};
      const fromValidator = pick(body.fromValidator, body.fromOperator);
      const toValidator = pick(body.toValidator, body.toOperator);
      if (!isAddressLike(fromValidator) || !isAddressLike(toValidator) || !isPositiveAmount(body.amount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid move stake request" });
        return;
      }

      const result = await moveStratoStake(req.accessToken, req.address as string, fromValidator, toValidator, body.amount);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async unstake(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body || {};
      const validator = pick(body.validator, body.operator);
      if (!isAddressLike(validator) || !isPositiveAmount(body.amount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid unstake request" });
        return;
      }

      const result = await unstakeStrato(req.accessToken, req.address as string, validator, body.amount);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // Shared by the STRATO reward and USDST fee claims: `{ validators?, claimAll? }`.
  private static parseClaimBody(req: Request, res: Response): { validators: string[]; claimAll: boolean } | null {
    const validators = Array.isArray(req.body?.validators)
      ? req.body.validators
      : Array.isArray(req.body?.operators) ? req.body.operators : [];
    const claimAll = parseOptionalBoolean(req.body?.claimAll);
    if (claimAll === null) {
      res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid claimAll" });
      return null;
    }
    if (!claimAll && (!validators.length || validators.some((validator: unknown) => !isAddressLike(validator)))) {
      res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid claim request" });
      return null;
    }
    return { validators, claimAll };
  }

  static async claim(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = StakingController.parseClaimBody(req, res);
      if (!parsed) return;

      const result = await claimStratoRewards(req.accessToken, req.address as string, parsed.validators, parsed.claimAll);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async claimOperatorRewards(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validator = req.body?.validator;
      if (!isOptionalAddress(validator)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid validator" });
        return;
      }

      const result = await claimStratoOperatorRewards(req.accessToken, req.address as string, validator);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async withdrawUnbonded(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const requestIds = Array.isArray(req.body?.requestIds) ? req.body.requestIds : [];
      const withdrawAll = parseOptionalBoolean(req.body?.withdrawAll);
      if (withdrawAll === null || requestIds.some((id: unknown) => !isNonNegativeAmount(id))) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid withdrawAll" });
        return;
      }

      const result = await withdrawStratoUnbonded(req.accessToken, req.address as string, requestIds, withdrawAll);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setCommission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { validator, commissionBps } = req.body || {};
      if (!isOptionalAddress(validator) || commissionBps === undefined || !isNonNegativeAmount(commissionBps)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid commission" });
        return;
      }

      const result = await setStratoCommission(req.accessToken, req.address as string, validator, String(commissionBps));
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async selfBond(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { validator, amount } = req.body || {};
      if (!isOptionalAddress(validator) || !isPositiveAmount(amount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid self-bond request" });
        return;
      }

      const result = await selfBondStrato(req.accessToken, req.address as string, validator, amount);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async unbondSelf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { validator, amount } = req.body || {};
      if (!isOptionalAddress(validator) || !isPositiveAmount(amount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid self-unbond request" });
        return;
      }

      const result = await unbondSelfStrato(req.accessToken, req.address as string, validator, amount);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async depositRewards(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { amount } = req.body || {};
      if (!isPositiveAmount(amount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid amount" });
        return;
      }

      const result = await depositStratoRewards(req.accessToken, req.address as string, amount);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // `{ validator, operator, commissionBps, ... }` or a `validators` batch of those (v2);
  // `{ operator, commissionBps, ... }` or an `operators` batch (v1, no validator).
  static async addOperator(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const inputs = Array.isArray(req.body?.validators)
        ? req.body.validators
        : Array.isArray(req.body?.operators) ? req.body.operators : [req.body || {}];
      const listings = inputs.map((item: any) => ({
        validator: pick(item?.validator, item?.validatorAddress),
        operator: item?.operator,
        commissionBps: item?.commissionBps,
        name: item?.name,
        description: item?.description,
        metadataURI: item?.metadataURI,
        protocolValidatorId: item?.protocolValidatorId,
      }));

      if (!listings.length || listings.some((item: any) =>
        !isAddressLike(item.operator) || !isNonNegativeAmount(item.commissionBps) || !isOptionalAddress(item.validator))) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid operator request" });
        return;
      }

      const result = await addStratoOperator(
        req.accessToken,
        req.address as string,
        listings.map((item: any) => ({ ...item, commissionBps: String(item.commissionBps) }))
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async removeOperator(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validator = pick(req.body?.validator, req.body?.operator);
      if (!isAddressLike(validator)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid validator" });
        return;
      }

      const result = await removeStratoOperator(req.accessToken, req.address as string, validator);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setOperatorCommission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validator = pick(req.body?.validator, req.body?.operator);
      const commissionBps = req.body?.commissionBps;
      if (!isAddressLike(validator) || commissionBps === undefined || !isNonNegativeAmount(commissionBps)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid operator commission request" });
        return;
      }

      const result = await setStratoOperatorCommission(req.accessToken, req.address as string, validator, String(commissionBps));
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setValidatorOperator(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { validator, operator } = req.body || {};
      if (!isAddressLike(validator) || !isAddressLike(operator)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid validator operator request" });
        return;
      }

      const result = await setStratoValidatorOperator(req.accessToken, req.address as string, validator, operator);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async startRewardSchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { rewardAmount, startTime, duration, baseRewardBps, name, description } = req.body || {};
      if (!isPositiveAmount(rewardAmount) || !isPositiveAmount(startTime) || !isPositiveAmount(duration) || !isNonNegativeAmount(baseRewardBps)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid reward schedule" });
        return;
      }

      const result = await startStratoRewardSchedule(
        req.accessToken,
        req.address as string,
        String(rewardAmount),
        String(startTime),
        String(duration),
        String(baseRewardBps),
        String(name || ""),
        String(description || "")
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async stopRewardSchedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await stopStratoRewardSchedule(req.accessToken, req.address as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // v2: `{ unbondingSeconds, maxCommissionBps, maxBatchSize }`; v1 also takes baseRewardBps.
  static async setParams(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { unbondingSeconds, baseRewardBps, maxCommissionBps, maxBatchSize } = req.body || {};
      if (
        [unbondingSeconds, maxCommissionBps, maxBatchSize].some((value) => !isNonNegativeAmount(value))
        || (baseRewardBps !== undefined && !isNonNegativeAmount(baseRewardBps))
      ) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid params" });
        return;
      }

      const result = await setStratoStakingParams(req.accessToken, req.address as string, {
        unbondingSeconds: String(unbondingSeconds),
        baseRewardBps: baseRewardBps === undefined ? undefined : String(baseRewardBps),
        maxCommissionBps: String(maxCommissionBps),
        maxBatchSize: String(maxBatchSize),
      });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // ---- proposer fees (USDST) ----

  static async claimFees(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = StakingController.parseClaimBody(req, res);
      if (!parsed) return;

      const result = await claimStratoFeeRewards(req.accessToken, req.address as string, parsed.validators, parsed.claimAll);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async claimOperatorFees(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validator = req.body?.validator;
      if (!isOptionalAddress(validator)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid validator" });
        return;
      }

      const result = await claimStratoOperatorFeeRewards(req.accessToken, req.address as string, validator);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // ---- validator lifecycle ----

  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body || {};
      const validator = pick(body.validator, body.validatorAddress);
      if (!isAddressLike(validator) || !isNonNegativeAmount(body.commissionBps) || !isOptionalSignature(body.signature)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid registration request" });
        return;
      }

      const result = await registerStratoOperator(req.accessToken, req.address as string, {
        validator,
        commissionBps: String(body.commissionBps),
        name: body.name,
        description: body.description,
        metadataURI: body.metadataURI,
        signature: body.signature,
      });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { validator, name, description, metadataURI, protocolValidatorId } = req.body || {};
      if (!isOptionalAddress(validator)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid validator" });
        return;
      }

      const result = await updateStratoOperatorProfile(req.accessToken, req.address as string, {
        validator,
        name,
        description,
        metadataURI,
        protocolValidatorId,
      });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // `{ validator }` for tryActivate / syncValidator / requestExit / cancelExit.
  private static lifecycleTarget(req: Request, res: Response): { ok: boolean; validator?: string } {
    const validator = pick(req.body?.validator, req.body?.operator);
    if (!isOptionalAddress(validator)) {
      res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid validator" });
      return { ok: false };
    }
    return { ok: true, validator };
  }

  static async activate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const target = StakingController.lifecycleTarget(req, res);
      if (!target.ok) return;

      const result = await activateStratoOperator(req.accessToken, req.address as string, target.validator);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async reconcile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await reconcileStratoValidatorSet(req.accessToken, req.address as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async sync(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const target = StakingController.lifecycleTarget(req, res);
      if (!target.ok) return;

      const result = await syncStratoValidator(req.accessToken, req.address as string, target.validator);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async requestExit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const target = StakingController.lifecycleTarget(req, res);
      if (!target.ok) return;

      const result = await requestStratoExit(req.accessToken, req.address as string, target.validator);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async cancelExit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const target = StakingController.lifecycleTarget(req, res);
      if (!target.ok) return;

      const result = await cancelStratoExit(req.accessToken, req.address as string, target.validator);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  // ---- admin (owner votes) ----

  static async setValidatorAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { operator, validatorAddress } = req.body || {};
      if (!isAddressLike(operator) || !isAddressLike(validatorAddress)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid validator address request" });
        return;
      }

      const result = await setStratoValidatorAddress(req.accessToken, req.address as string, operator, validatorAddress);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setValidatorParams(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { minStake, proposerFeeBps, maxConsecutiveMisses, jailCooldown } = req.body || {};
      if ([minStake, proposerFeeBps, maxConsecutiveMisses, jailCooldown].some((value) => !isNonNegativeAmount(value))) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid validator params" });
        return;
      }

      const result = await setStratoValidatorParams(req.accessToken, req.address as string, {
        minStake: String(minStake),
        proposerFeeBps: String(proposerFeeBps),
        maxConsecutiveMisses: String(maxConsecutiveMisses),
        jailCooldown: String(jailCooldown),
      });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setSelfBondGrace(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { selfBondGraceUntil } = req.body || {};
      if (!isPositiveAmount(selfBondGraceUntil)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid selfBondGraceUntil" });
        return;
      }

      const result = await setStratoSelfBondGrace(req.accessToken, req.address as string, String(selfBondGraceUntil));
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setSetParams(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        maxActiveValidators, hardCapActiveValidators, evictionMarginBps, maxSetMutationsPerBlock,
        exitNoticeSeconds, unkickCooldown, maxOperatorStakeBps, joinsPaused,
      } = req.body || {};
      const paused = parseOptionalBoolean(joinsPaused);
      if (
        [maxActiveValidators, hardCapActiveValidators, evictionMarginBps, maxSetMutationsPerBlock, exitNoticeSeconds, unkickCooldown, maxOperatorStakeBps]
          .some((value) => !isNonNegativeAmount(value)) || paused === null || joinsPaused === undefined
      ) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid set params" });
        return;
      }

      const result = await setStratoSetParams(req.accessToken, req.address as string, {
        maxActiveValidators: String(maxActiveValidators),
        hardCapActiveValidators: String(hardCapActiveValidators),
        evictionMarginBps: String(evictionMarginBps),
        maxSetMutationsPerBlock: String(maxSetMutationsPerBlock),
        exitNoticeSeconds: String(exitNoticeSeconds),
        unkickCooldown: String(unkickCooldown),
        maxOperatorStakeBps: String(maxOperatorStakeBps),
        joinsPaused: paused,
      });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setGovernance(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { governance, syncEnabled } = req.body || {};
      const enabled = parseOptionalBoolean(syncEnabled);
      if ((governance !== undefined && !isAddressLike(governance)) || enabled === null || syncEnabled === undefined) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid governance request" });
        return;
      }

      const result = await setStratoGovernance(req.accessToken, req.address as string, governance, enabled);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async recoverUnattributedFees(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { to, amount } = req.body || {};
      if (!isAddressLike(to) || !isPositiveAmount(amount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid recovery request" });
        return;
      }

      const result = await recoverStratoUnattributedFees(req.accessToken, req.address as string, to, String(amount));
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setEmergencyKicker(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { kicker } = req.body || {};
      if (!isAddressLike(kicker)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid kicker" });
        return;
      }

      const result = await setStratoEmergencyKicker(req.accessToken, req.address as string, kicker);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setGovernanceStakingContract(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { stakingContract } = req.body || {};
      if (stakingContract !== undefined && !isAddressLike(stakingContract)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid staking contract" });
        return;
      }

      const result = await setGovernanceStakingContract(req.accessToken, req.address as string, stakingContract);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setGovernanceHardCap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { hardCap } = req.body || {};
      if (!isNonNegativeAmount(hardCap)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid hard cap" });
        return;
      }

      const result = await setGovernanceHardCap(req.accessToken, req.address as string, String(hardCap));
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default StakingController;

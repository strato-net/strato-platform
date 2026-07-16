import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  addStratoOperator,
  claimStratoOperatorRewards,
  claimStratoRewards,
  depositStratoRewards,
  getStratoStakingInfo,
  moveStratoStake,
  removeStratoOperator,
  selfBondStrato,
  setStratoCommission,
  setStratoStakingParams,
  setStratoOperatorCommission,
  stakeStrato,
  startStratoRewardSchedule,
  stopStratoRewardSchedule,
  unbondSelfStrato,
  unstakeStrato,
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

const parseOptionalBoolean = (value: unknown): boolean | null => {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return null;
};

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

  static async stake(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const delegations = Array.isArray(req.body?.delegations) ? req.body.delegations : [];
      if (!delegations.length || delegations.some((item: any) => !isAddressLike(item?.operator) || !isPositiveAmount(item?.amount))) {
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
      const { fromOperator, toOperator, amount } = req.body || {};
      if (!isAddressLike(fromOperator) || !isAddressLike(toOperator) || !isPositiveAmount(amount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid move stake request" });
        return;
      }

      const result = await moveStratoStake(req.accessToken, req.address as string, fromOperator, toOperator, amount);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async unstake(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { operator, amount } = req.body || {};
      if (!isAddressLike(operator) || !isPositiveAmount(amount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid unstake request" });
        return;
      }

      const result = await unstakeStrato(req.accessToken, req.address as string, operator, amount);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async claim(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const operators = Array.isArray(req.body?.operators) ? req.body.operators : [];
      const claimAll = parseOptionalBoolean(req.body?.claimAll);
      if (claimAll === null) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid claimAll" });
        return;
      }
      if (!claimAll && (!operators.length || operators.some((operator: unknown) => !isAddressLike(operator)))) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid claim request" });
        return;
      }

      const result = await claimStratoRewards(req.accessToken, req.address as string, operators, claimAll);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async claimOperatorRewards(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await claimStratoOperatorRewards(req.accessToken, req.address as string);
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
      const { commissionBps } = req.body || {};
      if (commissionBps === undefined || !isNonNegativeAmount(commissionBps)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid commission" });
        return;
      }

      const result = await setStratoCommission(req.accessToken, req.address as string, String(commissionBps));
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async selfBond(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { amount } = req.body || {};
      if (!isPositiveAmount(amount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid self-bond request" });
        return;
      }

      const result = await selfBondStrato(req.accessToken, req.address as string, amount);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async unbondSelf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { amount } = req.body || {};
      if (!isPositiveAmount(amount)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid self-unbond request" });
        return;
      }

      const result = await unbondSelfStrato(req.accessToken, req.address as string, amount);
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

  static async addOperator(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const operatorInputs = Array.isArray(req.body?.operators)
        ? req.body.operators
        : [req.body || {}];

      if (!operatorInputs.length || operatorInputs.some((item: any) => !isAddressLike(item?.operator) || !isNonNegativeAmount(item?.commissionBps))) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid operator request" });
        return;
      }

      const result = await addStratoOperator(
        req.accessToken,
        req.address as string,
        operatorInputs.map((item: any) => ({
          operator: item.operator,
          commissionBps: String(item.commissionBps),
          name: item.name,
          description: item.description,
          metadataURI: item.metadataURI,
          protocolValidatorId: item.protocolValidatorId,
        }))
      );
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async removeOperator(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { operator } = req.body || {};
      if (!isAddressLike(operator)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid operator" });
        return;
      }

      const result = await removeStratoOperator(req.accessToken, req.address as string, operator);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async setOperatorCommission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { operator, commissionBps } = req.body || {};
      if (!isAddressLike(operator) || commissionBps === undefined || !isNonNegativeAmount(commissionBps)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid operator commission request" });
        return;
      }

      const result = await setStratoOperatorCommission(req.accessToken, req.address as string, operator, String(commissionBps));
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

  static async setParams(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { unbondingSeconds, baseRewardBps, maxCommissionBps, maxBatchSize } = req.body || {};
      if ([unbondingSeconds, baseRewardBps, maxCommissionBps, maxBatchSize].some((value) => !isNonNegativeAmount(value))) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid params" });
        return;
      }

      const result = await setStratoStakingParams(req.accessToken, req.address as string, {
        unbondingSeconds: String(unbondingSeconds),
        baseRewardBps: String(baseRewardBps),
        maxCommissionBps: String(maxCommissionBps),
        maxBatchSize: String(maxBatchSize),
      });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default StakingController;

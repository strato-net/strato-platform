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
  unbondSelfStrato,
  unstakeStrato,
  withdrawStratoUnbonded,
} from "../services/staking.service";

const isPositiveAmount = (value: unknown): boolean => {
  try {
    return BigInt(String(value || "0")) > 0n;
  } catch {
    return false;
  }
};

const isNonNegativeAmount = (value: unknown): boolean => {
  try {
    return BigInt(String(value)) >= 0n;
  } catch {
    return false;
  }
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
      if (!delegations.length || delegations.some((item: any) => !item?.operator || !isPositiveAmount(item?.amount))) {
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
      if (!fromOperator || !toOperator || !isPositiveAmount(amount)) {
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
      if (!operator || !isPositiveAmount(amount)) {
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
      const claimAll = Boolean(req.body?.claimAll);
      if (!claimAll && !operators.length) {
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
      const result = await withdrawStratoUnbonded(req.accessToken, req.address as string, requestIds, Boolean(req.body?.withdrawAll));
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

      if (!operatorInputs.length || operatorInputs.some((item: any) => !item?.operator || item?.commissionBps === undefined)) {
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
      if (!operator) {
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
      if (!operator || commissionBps === undefined || !isNonNegativeAmount(commissionBps)) {
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
      if (!isPositiveAmount(rewardAmount) || !isPositiveAmount(startTime) || !isPositiveAmount(duration) || baseRewardBps === undefined) {
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

  static async setParams(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { unbondingSeconds, baseRewardBps, maxCommissionBps, maxBatchSize } = req.body || {};
      if ([unbondingSeconds, baseRewardBps, maxCommissionBps, maxBatchSize].some((value) => value === undefined)) {
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

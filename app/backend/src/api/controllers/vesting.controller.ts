import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { claimVesting, getVestingsForAddress } from "../services/vesting.service";

const VESTING_ID_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;

class VestingController {
  static async getVestings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await getVestingsForAddress(req.accessToken, req.address as string);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async claim(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const vestingId = req.body?.vestingId;
      if (typeof vestingId !== "string" || !VESTING_ID_PATTERN.test(vestingId)) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Invalid vestingId" });
        return;
      }

      const result = await claimVesting(req.accessToken, req.address as string, vestingId);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default VestingController;

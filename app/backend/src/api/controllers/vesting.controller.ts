import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { claimVesting, getVestingsForAddress } from "../services/vesting.service";

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
      // The service validates the id (400) so every caller gets the same check.
      const result = await claimVesting(req.accessToken, req.address as string, String(req.body?.vestingId ?? ""));
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default VestingController;

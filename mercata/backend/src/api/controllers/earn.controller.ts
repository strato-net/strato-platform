import { Request, Response, NextFunction } from "express";
import { getTokenApys } from "../services/earn.service";

export default class EarnController {
  static async getTokenApys(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await getTokenApys(req.accessToken);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }
}

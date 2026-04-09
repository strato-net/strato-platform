import { Request, Response, NextFunction } from "express";
import { getTokenApys } from "../services/earn.service";
import { getCachedTokenApys } from "../services/earn.cache";

export default class EarnController {
  static async getTokenApys(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cached = getCachedTokenApys();
      if (cached) {
        res.json(cached);
        return;
      }
      const result = await getTokenApys(req.accessToken);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }
}

import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getStablecoinMetrics,
  getTvlMetrics,
} from "../services/metrics.service";

class MetricsController {
  static async getTvl(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const metrics = await getTvlMetrics(accessToken);
      res.status(RestStatus.OK).json(metrics);
    } catch (error) {
      next(error);
    }
  }

  static async getStablecoins(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const metrics = await getStablecoinMetrics(accessToken);
      res.status(RestStatus.OK).json(metrics);
    } catch (error) {
      next(error);
    }
  }
}

export default MetricsController;

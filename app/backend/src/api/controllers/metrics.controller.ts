import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getStablecoinMetrics,
  getTvlMetrics,
} from "../services/metrics.service";
import { getSupplyMetrics, getTokenSupply, TokenSupply } from "../services/supply.service";

// CoinGecko and CoinMarketCap poll these and expect a bare number with decimals applied.
const sendSupplyNumber = async (
  req: Request,
  res: Response,
  next: NextFunction,
  field: keyof Pick<TokenSupply, "totalSupplyFormatted" | "circulatingSupplyFormatted">
): Promise<void> => {
  try {
    const { accessToken } = req;
    const token = String(req.params.token || "");
    const supply = await getTokenSupply(accessToken, token);
    if (!supply) {
      res.status(RestStatus.NOT_FOUND).json({ error: `No supply data for token: ${token}` });
      return;
    }
    res
      .set("Cache-Control", "public, max-age=60")
      .type("application/json")
      .send(supply[field]);
  } catch (error) {
    next(error);
  }
};

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

  static async getSupply(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const metrics = await getSupplyMetrics(accessToken);
      res.set("Cache-Control", "public, max-age=60").status(RestStatus.OK).json(metrics);
    } catch (error) {
      next(error);
    }
  }

  static getTotalSupply(req: Request, res: Response, next: NextFunction): Promise<void> {
    return sendSupplyNumber(req, res, next, "totalSupplyFormatted");
  }

  static getCirculatingSupply(req: Request, res: Response, next: NextFunction): Promise<void> {
    return sendSupplyNumber(req, res, next, "circulatingSupplyFormatted");
  }
}

export default MetricsController;

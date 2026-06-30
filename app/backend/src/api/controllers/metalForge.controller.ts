import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getConfigs, mintMetal } from "../services/metalForge.service";

class MetalForgeController {
  static async getConfigs(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const configs = await getConfigs(accessToken);
      res.status(RestStatus.OK).json(configs);
    } catch (error) {
      next(error);
    }
  }

  static async buy(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, body } = req;
      const { metalToken, payToken, payAmount, minMetalOut } = body;

      if (!metalToken || !payToken || !payAmount || !minMetalOut) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "Missing required fields: metalToken, payToken, payAmount, minMetalOut" });
        return;
      }

      const result = await mintMetal(accessToken, userAddress as string, {
        metalToken,
        payToken,
        payAmount,
        minMetalOut,
      });
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default MetalForgeController;

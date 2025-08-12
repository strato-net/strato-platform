import { Request, Response, NextFunction } from "express";
import { 
  bridgeOut, 
  getBridgeableTokens,
  getNetworkConfigs, 
  getBridgeStatus 
} from "../services/bridge.service";
import { validateBridgeOut } from "../validators/bridge.validators";

class BridgeController {
  static async bridgeOut(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      validateBridgeOut(body);
      
      const result = await bridgeOut(accessToken, body);

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  }

  static async getBridgeableTokens(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { chainId } = req.params;
      
      if (!chainId) {
        res.status(400).json({ error: "chainId parameter is required" });
        return;
      }
      
      const result = await getBridgeableTokens(accessToken, chainId);
      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }

  static async getNetworkConfigs(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const result = await getNetworkConfigs(accessToken);
      const configData = {
        ...result,
        showTestnet: process.env.NODE_ENV !== "production" ? true : false,
      };

      res.json(configData);
    } catch (error: any) {
      next(error);
    }
  }

  static async getBridgeStatus(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { status } = req.params;

      const result = await getBridgeStatus(
        accessToken,
        req.address,
        {
          status,
          ...req.query
        }
      );

      res.json(result);
    } catch (error: any) {
      next(error);
    }
  }
}

export default BridgeController;

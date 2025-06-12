import { Request, Response, NextFunction } from "express";
import { BridgeService } from "../services/bridge.service";

// Extend Express Request type to include user
interface AuthenticatedRequest extends Request {
  user?: {
    token: string;
  };
}

export class BridgeController {
  private bridgeService: BridgeService;

  constructor() {
    this.bridgeService = new BridgeService();
  }

  public bridgeIn = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { accessToken, body } = req;

      // Process bridge transaction
      const result = await this.bridgeService.bridgeIn({
        ...body,
        accessToken,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  };

  public bridgeOut = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { accessToken, body } = req;

      // Process bridge transaction
      const result = await this.bridgeService.bridgeOut({
        ...body,
        accessToken,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  };

  public getBalance = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { accessToken } = req;
      const { tokenAddress } = req.params;

      const result = await this.bridgeService.getBalance({
        accessToken,
        tokenAddress,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  };

  public getBridgeInTokens = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { accessToken } = req;
      const { type } = req.params;

      const result = await this.bridgeService.getBridgeInTokens({
        accessToken,
        type
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  };

  public getBridgeOutTokens = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { accessToken } = req;
      const result = await this.bridgeService.getBridgeOutTokens({
        accessToken,
      });
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  }

  public userDepositStatus = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { accessToken } = req;
      const { status } = req.params;
      const { limit, orderBy, orderDirection, pageNo } = req.query;

      const result = await this.bridgeService.getUserDepositStatus({
        accessToken,
        status,
        limit: limit ? parseInt(limit as string) : undefined,
        orderBy: orderBy as string,
        orderDirection: orderDirection as string,
        pageNo: pageNo as string
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  };


  public userWithdrawalStatus = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
    
  ) => {
    try {
      const { accessToken } = req;
      const { status } = req.params;
      const { limit, orderBy, orderDirection, pageNo } = req.query;

      const result = await this.bridgeService.getUserWithdrawalStatus({
        accessToken,
        status,
        limit: limit ? parseInt(limit as string) : undefined,
        orderBy: orderBy as string,
        orderDirection: orderDirection as string,
        pageNo: pageNo as string
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      next(error);
    }
  };
}

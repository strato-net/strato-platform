import { Request, Response, NextFunction } from 'express';
import { BridgeService } from '../services/bridge.service';
import { BridgeValidator } from '../validators/bridge.validator';

// Extend Express Request type to include user
interface AuthenticatedRequest extends Request {
  user?: {
    token: string;
  };
}

export class BridgeController {
  private bridgeService: BridgeService;
  private bridgeValidator: BridgeValidator;

  constructor() {
    this.bridgeService = new BridgeService();
    this.bridgeValidator = new BridgeValidator();
  }

  public ethToStrato = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
     

      // Get userToken from middleware
      const userToken = req.user?.token;
      if (!userToken) {
       console.log("user not found ")
        return;
      }

      // Validate request body
      const validationError = this.bridgeValidator.validateEthToStrato(req.body);
      if (validationError) {
      console.log("validation error",validationError);
        return;
      }

      // Process bridge transaction
      const result = await this.bridgeService.ethToStrato({
        ...req.body,
        userToken
      });

      console.log('Bridge transaction processed successfully', { result });

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
  console.log("error",error);
      next(error);
    }
  };
} 
import { Request, Response, NextFunction } from 'express';
import { BridgeService } from '../services/bridge.service';
import { BridgeValidator } from '../validators/bridge.validator';
import logger from '../../utils/logger';

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
      logger.info('Received ETH to STRATO bridge request', {
        body: req.body,
        user: req.user
      });

      // Get userToken from middleware
      const userToken = req.user?.token;
      if (!userToken) {
        logger.error('User token not found in request');
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      // Validate request body
      const validationError = this.bridgeValidator.validateEthToStrato(req.body);
      if (validationError) {
        logger.error('Validation failed', { error: validationError });
        res.status(400).json({
          success: false,
          error: validationError
        });
        return;
      }

      // Process bridge transaction
      const result = await this.bridgeService.ethToStrato({
        ...req.body,
        userToken
      });

      logger.info('Bridge transaction processed successfully', { result });

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      logger.error('Error in ETH to STRATO bridge', {
        error: error.message,
        stack: error.stack
      });
      next(error);
    }
  };
} 
import { Request, Response } from "express";
import { networkId } from "../../config/config";

class ConfigController {
  static async getConfig(req: Request, res: Response) {
    try {
      // Return basic configuration
      res.json({
        success: true,
        data: {
          projectId: process.env.WAGMI_PROJECT_ID || 'PROJECT_ID_UNSET',
          networkId: networkId,
          stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to get configuration"
      });
    }
  }
}

export default ConfigController; 
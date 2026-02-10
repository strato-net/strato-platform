import { Request, Response } from "express";
import { networkId, creditCardTopUp } from "../../config/config";

class ConfigController {
  static async getConfig(req: Request, res: Response) {
    try {
      // Return basic configuration
      res.json({
        success: true,
        data: {
          projectId: process.env.WAGMI_PROJECT_ID || 'PROJECT_ID_UNSET',
          networkId: networkId,
          creditCardTopUpAddress: creditCardTopUp || undefined,
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
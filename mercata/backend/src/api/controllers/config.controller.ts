import { Request, Response } from "express";

class ConfigController {
  static async getConfig(req: Request, res: Response) {
    try {
      // Return basic configuration
      res.json({
        success: true,
        data: {
          projectId: process.env.WAGMI_PROJECT_ID || 'PROJECT_ID_UNSET',
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
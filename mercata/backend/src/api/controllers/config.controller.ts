import { Request, Response } from "express";
import { getConfig } from "../services/config.service";

class ConfigController {
  static async getConfig(req: Request, res: Response) {
    try {
      const config = getConfig();

      res.json({
        success: true,
        data: config
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
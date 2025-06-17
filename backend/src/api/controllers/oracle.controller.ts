import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  setPrice,
} from "../services/oracle.service";

class OracleController {
  static async setPrice(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, body } = req;
      const result = await setPrice(accessToken, body);
      res.status(RestStatus.OK).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default OracleController;

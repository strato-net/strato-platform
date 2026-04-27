import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getBootstrap, executeLoop, getPosition } from "../services/loop.service";
import { validateExecuteArgs } from "../validators/loop.validator";

class LoopController {
  static async bootstrap(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const data = await getBootstrap(req.accessToken!);
      res.status(RestStatus.OK).json(data);
      next();
    } catch (e) {
      next(e);
    }
  }

  static async execute(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      validateExecuteArgs(req.body);

      const result = await executeLoop(req.accessToken!, req.address!, req.body);

      res.status(RestStatus.OK).json(result);
      next();
    } catch (e) {
      next(e);
    }
  }

  static async position(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const data = await getPosition(req.accessToken!, req.address!);
      res.status(RestStatus.OK).json(data);
      next();
    } catch (e) {
      next(e);
    }
  }
}

export default LoopController;

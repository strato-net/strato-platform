import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getEvents, getContractInfo } from "../services/events.service";

class EventsController {
  static async getEvents(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, query } = req;
      const events = await getEvents(accessToken, query as Record<string, string>);
      res.status(RestStatus.OK).json(events);
    } catch (error) {
      next(error);
    }
  }

  static async getContractInfo(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const contractInfo = await getContractInfo(accessToken);
      res.status(RestStatus.OK).json(contractInfo);
    } catch (error) {
      next(error);
    }
  }
}

export default EventsController;

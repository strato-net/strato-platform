import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getEvents, getContractInfo, getActivities } from "../services/events.service";

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

  static async getActivities(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken, address: userAddress, query } = req;
      const activities = await getActivities(accessToken, {
        limit: query?.limit ? parseInt(query.limit as string) : 10,
        offset: query?.offset ? parseInt(query.offset as string) : 0,
        userAddress: query?.userAddress as string || (query?.my === 'true' ? userAddress : undefined),
        type: query?.type as string,
      });
      res.status(RestStatus.OK).json(activities);
    } catch (error) {
      next(error);
    }
  }
}

export default EventsController; 
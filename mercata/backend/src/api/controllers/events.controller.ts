import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getEvents, getContractInfo, getActivitiesByTypes, type ActivityTypePair } from "../services/events.service";

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
      const { accessToken, address, body, query } = req;

      let activityTypePairs: ActivityTypePair[] = [];
      if (Array.isArray(body?.activityTypePairs)) {
        activityTypePairs = body.activityTypePairs.map((pair: ActivityTypePair) => ({
          contract_name: pair.contract_name,
          event_name: pair.event_name,
          filterConfig: pair.filterConfig,
        }));
      } else if (query.activity_types) {
        const activityTypesParam = query.activity_types as string;
        let filterConfigsMap: Map<string, ActivityTypePair["filterConfig"]> = new Map();
        if (query.filter_configs) {
          try {
            const filterConfigs = JSON.parse(query.filter_configs as string) as Array<{
              contract_name: string;
              event_name: string;
              filterConfig: ActivityTypePair["filterConfig"];
            }>;
            filterConfigs.forEach(config => {
              const key = `${config.contract_name}:${config.event_name}`;
              filterConfigsMap.set(key, config.filterConfig);
            });
          } catch (error) {
            // If parsing fails, continue without filter configs (will use defaults)
            console.warn("Failed to parse filter_configs:", error);
          }
        }

        activityTypePairs = activityTypesParam.split(',').map((pair) => {
          const [contract_name, event_name] = pair.split(':');
          const key = `${contract_name}:${event_name}`;
          return {
            contract_name,
            event_name,
            filterConfig: filterConfigsMap.get(key)
          };
        });
      }

      if (!activityTypePairs.length) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "activity_types parameter required" });
        return;
      }

      const limit = parseInt(String(body?.limit ?? query.limit ?? "10"));
      const offset = parseInt(String(body?.offset ?? query.offset ?? "0"));
      const userAddress = (body?.myActivity === true || query.my_activity === 'true') ? address : undefined;
      const timeRange = (body?.timeRange || query.time_range) as string | undefined;

      const activities = await getActivitiesByTypes(
        accessToken,
        activityTypePairs,
        userAddress,
        limit,
        offset,
        timeRange
      );

      res.status(RestStatus.OK).json(activities);
    } catch (error) {
      next(error);
    }
  }
}

export default EventsController;

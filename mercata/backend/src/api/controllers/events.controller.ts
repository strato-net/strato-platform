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
      const { accessToken, address, query } = req;

      // Parse activity type pairs from query
      // Format: activity_types=contract1:event1,contract2:event2
      const activityTypesParam = query.activity_types as string;
      if (!activityTypesParam) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "activity_types parameter required" });
        return;
      }

      // Parse filter configs from query (JSON string)
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

      const activityTypePairs: ActivityTypePair[] = activityTypesParam.split(',').map((pair) => {
        const [contract_name, event_name] = pair.split(':');
        const key = `${contract_name}:${event_name}`;
        return { 
          contract_name, 
          event_name,
          filterConfig: filterConfigsMap.get(key)
        };
      });

      const limit = parseInt(query.limit as string || "10");
      const offset = parseInt(query.offset as string || "0");
      const userAddress = query.my_activity === 'true' ? address : undefined;
      const timeRange = query.time_range as string | undefined;

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
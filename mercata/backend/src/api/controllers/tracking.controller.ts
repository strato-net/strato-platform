import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import {
  getTrackingActivity,
  MAX_TRACKING_ADDRESSES,
  normalizeTrackingAddresses,
} from "../services/tracking.service";

class TrackingController {
  static async getActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { accessToken } = req;
      const addresses = normalizeTrackingAddresses(req.body?.addresses);
      if (!addresses) {
        res.status(RestStatus.BAD_REQUEST).json({
          error: `addresses must be 1-${MAX_TRACKING_ADDRESSES} 20-byte hex addresses`,
        });
        return;
      }
      const activity = await getTrackingActivity(accessToken, addresses);
      res.status(RestStatus.OK).json(activity);
    } catch (error) {
      next(error);
    }
  }
}

export default TrackingController;

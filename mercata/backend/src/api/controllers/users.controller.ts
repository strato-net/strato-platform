import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { isUserAdmin } from "../services/user.service";

class UsersController {
  static async me(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { address: userAddress, accessToken } = req;

      if (!userAddress || !accessToken) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "User not found or access token required" });
        return;
      }

      const isAdmin = await isUserAdmin(accessToken, userAddress);
      
      res.status(RestStatus.OK).json({ userAddress, isAdmin });
      next();
    } catch (e) {
      next(e);
    }
  }
}

export default UsersController;

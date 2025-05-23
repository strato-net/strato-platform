import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";

class UsersController {
  static async me(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { address: userAddress } = req;

      if (!userAddress) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "User not found" });
      } else {
        res.status(RestStatus.OK).json({ userAddress });
      }

      next();
    } catch (e) {
      next(e);
    }
  }
}

export default UsersController;

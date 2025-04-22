import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";

class AuthenticationController {
  static async logout(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      res.status(RestStatus.OK).json({ logoutUrl: "/auth/logout" });
      next();
    } catch (error) {
      next(error);
    }
  }
}

export default AuthenticationController;

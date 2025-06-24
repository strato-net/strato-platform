import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getAdmin, isUserAdmin, addAdmin, removeAdmin } from "../services/user.service";

class UserController {
  static async me(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { address: userAddress, accessToken } = req;
      const isAdmin = await isUserAdmin(accessToken, userAddress);
      
      res.status(RestStatus.OK).json({ userAddress, isAdmin });
      next();
    } catch (e) {
      next(e);
    }
  }

  static async admin(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const admins = await getAdmin(accessToken);
      res.status(RestStatus.OK).json({ admins });
      next();
    } catch (e) {
      next(e);
    }
  }

  static async addAdmin(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { userAddress } = req.body;

      if (!userAddress) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "User address is required" });
        return;
      }

      const result = await addAdmin(accessToken, userAddress);
      res.status(RestStatus.CREATED).json({ 
        message: "Admin added successfully", 
        userAddress,
        status: result.status,
        hash: result.hash
      });
      next();
    } catch (e) {
      next(e);
    }
  }

  static async removeAdmin(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { accessToken } = req;
      const { userAddress } = req.body;

      if (!userAddress) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "User address is required" });
        return;
      }

      const result = await removeAdmin(accessToken, userAddress);
      res.status(RestStatus.OK).json({ 
        message: "Admin removed successfully", 
        userAddress,
        status: result.status,
        hash: result.hash
      });
      next();
    } catch (e) {
      next(e);
    }
  }
}

export default UserController;

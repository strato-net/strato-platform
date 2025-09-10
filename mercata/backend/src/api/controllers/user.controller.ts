import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";
import { getAdmin, isUserAdmin, addAdmin, removeAdmin } from "../services/user.service";
import { validateUserAddress } from "../validators/common.validators";

class UserController {
  static async me(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { address: userAddress, accessToken, userName } = req;
      const isAdmin = await isUserAdmin(accessToken, userAddress);
      
      res.status(RestStatus.OK).json({ userAddress, isAdmin, userName });
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
      const { accessToken, address: userAddress } = req;
      const { userAddress: adminAddress } = req.body;

      validateUserAddress(adminAddress);

      const result = await addAdmin(accessToken, userAddress as string, adminAddress);
      res.status(RestStatus.CREATED).json({ 
        message: "Admin added successfully", 
        userAddress: adminAddress,
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
      const { accessToken, address: userAddress } = req;
      const { userAddress: adminAddress } = req.body;

      validateUserAddress(adminAddress);

      const result = await removeAdmin(accessToken, userAddress as string, adminAddress);
      res.status(RestStatus.OK).json({ 
        message: "Admin removed successfully", 
        userAddress: adminAddress,
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

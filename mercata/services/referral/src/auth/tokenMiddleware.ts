import {RequestHandler, Request, Response, NextFunction} from "express";
import { verifyAccessTokenSignature, getTokenFromHeader, getUserKey } from "../auth";

class AuthHandler {
  /**
   * Middleware that enforces OAuth on incoming requests
   * and extracts the user's STRATO address.
   */
  static authorizeRequest(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Get token from header
        const token = getTokenFromHeader(req);
        if (!token) throw new Error("Missing or invalid authorization header");

        // Verify token signature
        await verifyAccessTokenSignature(token);

        // Get user address from token
        const userAddress = await getUserKey(token);

        // Make user address available to request handler
        res.locals.userAddress = userAddress;
        return next();
      } catch (error: any) {
        return res.status(401).json({
          error: "Failed to get user address from token",
          message: error.message
        });
      }
    }
  }
}

export default AuthHandler;
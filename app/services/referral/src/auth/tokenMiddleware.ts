import { RequestHandler, Request, Response, NextFunction } from "express";
import { walletClaimAddress } from "./walletClaim";

class AuthHandler {
  /**
   * Middleware that lets a redeem request through when its own signature
   * authorizes it (./walletClaim), and records the recipient on res.locals.
   */
  static authorizeRequest(): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.locals.userAddress = await walletClaimAddress(req.headers["x-wallet-address"], req.body);
        return next();
      } catch (error: any) {
        return res.status(401).json({
          error: "The claim is not authorized",
          message: error.message,
        });
      }
    };
  }
}

export default AuthHandler;

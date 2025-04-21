import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";

class AuthenticationController {
  static async callback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // You can insert authentication validation logic here if needed
      
      // After successful authentication, redirect to the homepage or intended location
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Perform logout logic here (e.g., clearing session, tokens, cookies)

      res.status(RestStatus.OK).json({ logoutUrl: '/auth/logout' });
    } catch (error) {
      next(error);
    }
  }
}

export default AuthenticationController;
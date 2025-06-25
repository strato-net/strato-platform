import { Request, Response, NextFunction } from "express";
import RestStatus from "http-status-codes";

class UsersController {
  static async me(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      // Debug: show incoming If-None-Match / caching headers
      console.log("[/users/me] If-None-Match:", req.headers["if-none-match"]);
      const { address: userAddress, userName } = req;

      if (!userAddress) {
        res.status(RestStatus.BAD_REQUEST).json({ error: "User not found" });
      } else {
        const normalize = (addr?: string) => (addr || "").trim().replace(/^0x/i, "").toLowerCase();
        const normUser = normalize(userAddress);
        const normAdmin = normalize(process.env.ADMIN_ADDRESS);
        console.log("[/users/me] compare", normUser, normAdmin);
        const isAdmin = normUser === normAdmin;
        // Prevent caching so client always receives body (avoids 304)
        res.set("Cache-Control", "no-store, no-cache, must-revalidate");
        res.status(RestStatus.OK).json({ userAddress, isAdmin, userName });
      }

      // Log final status once response is sent
      res.on("finish", () => {
        console.log("[/users/me] response status", res.statusCode);
      });

      next();
    } catch (e) {
      next(e);
    }
  }
}

export default UsersController;

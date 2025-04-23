import { Request, Router, Response, NextFunction } from 'express';

import packageJson from "../../package.json";

import authHandler from "./middleware/authHandler";
import TokensController from "./controllers/tokens.controller";
import AuthenticationController from "./controllers/authentication.controller";
import UsersController from "./controllers/users.controller";


const router = Router();

router.get("/authentication/logout", authHandler.authorizeRequest(), AuthenticationController.logout);

router.get("/users/me", authHandler.authorizeRequest(true), UsersController.me);

router.get("/tokens/:address", authHandler.authorizeRequest(true), TokensController.get);
router.get("/tokens/", authHandler.authorizeRequest(true), TokensController.getAll);
router.post("/tokens/", authHandler.authorizeRequest(), TokensController.create);
router.post("/tokens/transfer", authHandler.authorizeRequest(), TokensController.transfer);

router.get("/health", (_req: Request, res: Response, next: NextFunction) => {
  res.json({
    name: packageJson.name,
    version: packageJson.version,
    timestamp: new Date().toISOString(),
  });
  return next()
});

export default router;

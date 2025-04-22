import { Router, Request, Response, NextFunction } from 'express';

import packageJson from "../../package.json";
import { ExtendedRequest } from "../types/types";

import authHandler from "./middleware/authHandler";
import AssetsController from "./controllers/assets.controller";
import AuthenticationController from "./controllers/authentication.controller";
import UsersController from "./controllers/users.controller";


const router = Router();

router.get("/authentication/logout", authHandler.authorizeRequest(), AuthenticationController.logout);

router.get("/users/me", authHandler.authorizeRequest(true), UsersController.me);

router.get("/assets/:address", authHandler.authorizeRequest(true), AssetsController.get);
router.get("/assets/", authHandler.authorizeRequest(true), AssetsController.getAll);
router.post("/assets/", authHandler.authorizeRequest(), AssetsController.create);
router.post("/assets/transfer", authHandler.authorizeRequest(), AssetsController.transfer);

router.get("/health", (_req: ExtendedRequest, res: Response, next: NextFunction) => {
  res.json({
    name: packageJson.name,
    version: packageJson.version,
    timestamp: new Date().toISOString(),
  });
  return next()
});

export default router;

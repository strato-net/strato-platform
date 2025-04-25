import { Request, Router, Response, NextFunction } from 'express';

import packageJson from "../../package.json";

import authHandler from "./middleware/authHandler";

import TokensController from "./controllers/tokens.controller";
import PoolsController from './controllers/pools.controller';
import LendingController from './controllers/lending.controller';
import AuthenticationController from "./controllers/authentication.controller";
import UsersController from "./controllers/users.controller";


const router = Router();

router.get("/authentication/logout", authHandler.authorizeRequest(), AuthenticationController.logout);

router.get("/users/me", authHandler.authorizeRequest(true), UsersController.me);

router.get("/tokens/:address", authHandler.authorizeRequest(true), TokensController.get);
router.get("/tokens/", authHandler.authorizeRequest(true), TokensController.getAll);
router.get("/tokens/table/balance", authHandler.authorizeRequest(true), TokensController.getBalance);
router.post("/tokens/", authHandler.authorizeRequest(), TokensController.create);
router.post("/tokens/transfer", authHandler.authorizeRequest(), TokensController.transfer);

router.get("/pools/:address", authHandler.authorizeRequest(true), PoolsController.get);
router.get("/pools/", authHandler.authorizeRequest(true), PoolsController.getAll);
router.get("/pools/getStableToTokenInputPrice/:address", authHandler.authorizeRequest(true), PoolsController.getStableToTokenInputPrice);
router.get("/pools/getStableToTokenOutputPrice/:address", authHandler.authorizeRequest(true), PoolsController.getStableToTokenOutputPrice);
router.get("/pools/getTokenToStableInputPrice/:address", authHandler.authorizeRequest(true), PoolsController.getTokenToStableInputPrice);
router.get("/pools/getTokenToStableOutputPrice/:address", authHandler.authorizeRequest(true), PoolsController.getTokenToStableOutputPrice);
router.get("/pools/getCurrentTokenPrice/:address", authHandler.authorizeRequest(true), PoolsController.getCurrentTokenPrice);
router.get("/pools/getCurrentStablePrice/:address", authHandler.authorizeRequest(true), PoolsController.getCurrentStablePrice);
router.post("/pools/", authHandler.authorizeRequest(), PoolsController.create);
router.post("/pools/addLiquidity", authHandler.authorizeRequest(), PoolsController.addLiquidity);
router.post("/pools/removeLiquidity", authHandler.authorizeRequest(), PoolsController.removeLiquidity);
router.post("/pools/swap", authHandler.authorizeRequest(), PoolsController.swap);

router.get("/lending/:address", authHandler.authorizeRequest(true), LendingController.get);
router.get("/lending/", authHandler.authorizeRequest(true), LendingController.getAll);
router.post("/lending/", authHandler.authorizeRequest(), LendingController.create);
router.post("/lending/manageLiquidity", authHandler.authorizeRequest(), LendingController.manageLiquidity);
router.post("/lending/getLoan", authHandler.authorizeRequest(), LendingController.getLoan);
router.post("/lending/repayLoan", authHandler.authorizeRequest(), LendingController.repayLoan);

router.get("/health", (_req: Request, res: Response, next: NextFunction) => {
  res.json({
    name: packageJson.name,
    version: packageJson.version,
    timestamp: new Date().toISOString(),
  });
  return next()
});

export default router;

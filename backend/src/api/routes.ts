import { Request, Router, Response, NextFunction } from "express";

import packageJson from "../../package.json";

import authHandler from "./middleware/authHandler";

import TokensController from "./controllers/tokens.controller";
import SwappingController from "./controllers/swapping.controller";
import LendingController from "./controllers/lending.controller";
import UsersController from "./controllers/users.controller";
import OnRampController from "./controllers/onramp.controller";

const router = Router();

router.get("/users/me", authHandler.authorizeRequest(), UsersController.me);

router.get("/tokens/faucets", authHandler.authorizeRequest(true), TokensController.getFaucets);
router.get("/tokens/balance", authHandler.authorizeRequest(), TokensController.getBalance);
router.get("/tokens/:address", authHandler.authorizeRequest(true), TokensController.get);
router.get("/tokens/", authHandler.authorizeRequest(true), TokensController.getAll);
router.post("/tokens/", authHandler.authorizeRequest(), TokensController.create);
router.post("/tokens/faucet", authHandler.authorizeRequest(), TokensController.faucet);
router.post("/tokens/transfer", authHandler.authorizeRequest(), TokensController.transfer);
router.post("/tokens/approve", authHandler.authorizeRequest(), TokensController.approve);
router.post("/tokens/transferFrom", authHandler.authorizeRequest(), TokensController.transferFrom);

router.get("/swap/swappableTokens/", authHandler.authorizeRequest(true), SwappingController.getSwapableTokens);
router.get("/swap/swappableTokenPairs/:address", authHandler.authorizeRequest(true), SwappingController.getSwapableTokenPairs);
router.get("/swap/poolByTokenPair/", authHandler.authorizeRequest(true), SwappingController.getPoolByTokenPair);
router.get("/swap/calculateSwap/", authHandler.authorizeRequest(true), SwappingController.calculateSwap);
router.get("/swap/lpToken", authHandler.authorizeRequest(), SwappingController.getLPTokens);
router.get("/swap/:address", authHandler.authorizeRequest(true), SwappingController.get);
router.get("/swap/", authHandler.authorizeRequest(true), SwappingController.getAll);
router.post("/swap/", authHandler.authorizeRequest(), SwappingController.create);
router.post("/swap/addLiquidity", authHandler.authorizeRequest(), SwappingController.addLiquidity);
router.post("/swap/removeLiquidity", authHandler.authorizeRequest(), SwappingController.removeLiquidity);
router.post("/swap/swap", authHandler.authorizeRequest(), SwappingController.swap);

router.get("/lend/", authHandler.authorizeRequest(true), LendingController.get);
router.get("/lend/depositableTokens/", authHandler.authorizeRequest(), LendingController.getDepositableTokens);
router.get("/lend/withdrawableTokens/", authHandler.authorizeRequest(), LendingController.getWithdrawableTokens);
router.get("/lend/loans/", authHandler.authorizeRequest(), LendingController.getLoans);
router.post("/lend/setPrice", authHandler.authorizeRequest(), LendingController.setPrice);
router.post("/lend/manageLiquidity", authHandler.authorizeRequest(), LendingController.manageLiquidity);
router.post("/lend/getLoan", authHandler.authorizeRequest(), LendingController.getLoan);
router.post("/lend/repayLoan", authHandler.authorizeRequest(), LendingController.repayLoan);

router.get("/onramp/", authHandler.authorizeRequest(true), OnRampController.get);
router.post("/onramp/sell", authHandler.authorizeRequest(), OnRampController.onRampSell);
router.post("/onramp/lock", authHandler.authorizeRequest(), OnRampController.onRampLock);
router.post("/onramp/unlock", authHandler.authorizeRequest(), OnRampController.unlockTokens);


router.get("/health", (_req: Request, res: Response, next: NextFunction) => {
  res.json({
    name: packageJson.name,
    version: packageJson.version,
    timestamp: new Date().toISOString(),
  });
  return next();
});

export default router;

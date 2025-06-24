import { Request, Router, Response, NextFunction } from "express";

import packageJson from "../../package.json";

import authHandler from "./middleware/authHandler";

import TokensController from "./controllers/tokens.controller";
import SwappingController from "./controllers/swapping.controller";
import LendingController from "./controllers/lending.controller";
import UsersController from "./controllers/users.controller";
import OnRampController from "./controllers/onramp.controller";
import { BridgeController } from "./controllers/bridge.controller";
import OracleController from "./controllers/oracle.controller";

const router = Router();
const bridgeController = new BridgeController();

router.get("/users/me", authHandler.authorizeRequest(), UsersController.me);

router.get("/tokens/balance", authHandler.authorizeRequest(), TokensController.getBalance);
router.get("/tokens/active", authHandler.authorizeRequest(true), TokensController.getActive);
router.get("/tokens/:address", authHandler.authorizeRequest(true), TokensController.get);
router.get("/tokens/", authHandler.authorizeRequest(true), TokensController.getAll);
router.post("/tokens/", authHandler.authorizeRequest(), TokensController.create);
router.post("/tokens/transfer", authHandler.authorizeRequest(), TokensController.transfer);
router.post("/tokens/approve", authHandler.authorizeRequest(), TokensController.approve);
router.post("/tokens/transferFrom", authHandler.authorizeRequest(), TokensController.transferFrom);
router.post("/tokens/setStatus", authHandler.authorizeRequest(), TokensController.setStatus);

router.get("/swap/swappableTokens/", authHandler.authorizeRequest(true), SwappingController.getSwapableTokens);
router.get("/swap/swappableTokenPairs/:address", authHandler.authorizeRequest(true), SwappingController.getSwapableTokenPairs);
router.get("/swap/poolByTokenPair/", authHandler.authorizeRequest(true), SwappingController.getPoolByTokenPair);
router.get("/swap/calculateSwap/", authHandler.authorizeRequest(true), SwappingController.calculateSwap);
router.get("/swap/calculateSwapReverse/", authHandler.authorizeRequest(true), SwappingController.calculateSwapReverse);
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
router.get("/lend/loans/:id", authHandler.authorizeRequest(true), LendingController.getLoanById);
router.post("/lend/depositLiquidity", authHandler.authorizeRequest(), LendingController.depositLiquidity);
router.post("/lend/withdrawLiquidity", authHandler.authorizeRequest(), LendingController.withdrawLiquidity);
router.post("/lend/repay", authHandler.authorizeRequest(), LendingController.repay);
router.post("/lend/manageLiquidity", authHandler.authorizeRequest(), LendingController.manageLiquidity);
router.post("/lend/borrow", authHandler.authorizeRequest(), LendingController.borrow);

// Liquidation routes
router.get("/lend/liquidate", authHandler.authorizeRequest(true), LendingController.listLiquidatable);
router.get("/lend/liquidate/near-unhealthy", authHandler.authorizeRequest(true), LendingController.listNearUnhealthy);
router.get("/lend/liquidate/:id", authHandler.authorizeRequest(true), LendingController.getLiquidatable);
router.post("/lend/liquidate/:id", authHandler.authorizeRequest(), LendingController.executeLiquidation);

// Admin configuration routes
router.post("/lend/setInterestRate", authHandler.authorizeRequest(), LendingController.setInterestRate);
router.post("/lend/setCollateralRatio", authHandler.authorizeRequest(), LendingController.setCollateralRatio);
router.post("/lend/setLiquidationBonus", authHandler.authorizeRequest(), LendingController.setLiquidationBonus);

// ----- Oracle -----
router.get("/oracle/price", authHandler.authorizeRequest(true), OracleController.getPrice);
router.post("/oracle/price", authHandler.authorizeRequest(), OracleController.setPrice);

// ----- Onramp -----
router.get("/onramp/", authHandler.authorizeRequest(true), OnRampController.get);
router.post("/onramp/buy", authHandler.authorizeRequest(), OnRampController.buy);
router.post("/onramp/sell", authHandler.authorizeRequest(), OnRampController.sell);

router.post("/bridge/bridgeIn", authHandler.authorizeRequest(), bridgeController.bridgeIn);
router.post("/bridge/bridgeOut", authHandler.authorizeRequest(), bridgeController.bridgeOut);
router.get("/bridge/balance/:tokenAddress", authHandler.authorizeRequest(), bridgeController.getBalance);
router.get("/bridge/bridgeInTokens", authHandler.authorizeRequest(), bridgeController.getBridgeInTokens);
router.get("/bridge/bridgeOutTokens", authHandler.authorizeRequest(), bridgeController.getBridgeOutTokens);
router.get("/bridge/depositStatus/:status", authHandler.authorizeRequest(), bridgeController.userDepositStatus);
router.get("/bridge/withdrawalStatus/:status", authHandler.authorizeRequest(), bridgeController.userWithdrawalStatus);

router.get("/health", (_req: Request, res: Response, next: NextFunction) => {
  res.json({
    name: packageJson.name,
    version: packageJson.version,
    timestamp: new Date().toISOString(),
  });
  return next();
});

export default router;

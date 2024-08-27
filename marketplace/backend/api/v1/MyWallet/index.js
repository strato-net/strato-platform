import express from "express";
import WalletController from "./wallet.controller";
import { Wallet } from "../endpoints";
import loadDapp from "../../middleware/loadDappHandler";
import authHandler from "../../middleware/authHandler";
import wallet from "../../../dapp/wallet/wallet";

const router = express.Router();

router.get(
  Wallet.getWalletSummary,
  authHandler.authorizeRequest(),
  loadDapp,
  WalletController.getWalletSummary
);

router.get(
  Wallet.getWalletAssets,
  authHandler.authorizeRequest(),
  loadDapp,
  WalletController.getWalletAssets
);

router.get(
  Wallet.getStratsBalance,
  authHandler.authorizeRequest(),
  loadDapp,
  WalletController.getStratsBalance
);

export default router;

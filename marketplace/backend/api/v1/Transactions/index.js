import express from "express";
import TransactionController from "./transaction.controller";
import { Transaction } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  Transaction.get,
  authHandler.authorizeRequest(),
  loadDapp,
  TransactionController.getAllTransactions
);

export default router;

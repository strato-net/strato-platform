import express from "express";
import OrderLineController from "./orderLine.controller";
import { OrderLine } from "../endpoints";
import authHandler from "../../middleware/authHandler";
import loadDapp from "../../middleware/loadDappHandler";

const router = express.Router();

router.get(
  OrderLine.get,
  authHandler.authorizeRequest(),
  loadDapp,
  OrderLineController.get
);





export default router;

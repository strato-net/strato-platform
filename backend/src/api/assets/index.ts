import { Router } from "express";
import AssetsController from "./assets.controller";
import authHandler from "../../middleware/authHandler";

const router = Router();

router.get(
  "/:address",
  authHandler.authorizeRequest(true),
  AssetsController.get
);

router.get("/", authHandler.authorizeRequest(true), AssetsController.getAll);

router.post("/", authHandler.authorizeRequest(), AssetsController.create);

router.post(
  "/transfer",
  authHandler.authorizeRequest(),
  AssetsController.transfer
);

export default router;

import { Request, Router, Response, NextFunction } from "express";

import packageJson from "../../package.json";

import OnRampController from "./controllers/onramp.controller";

const router = Router();


router.post("/checkout", OnRampController.onRampLock);


router.get("/health", (_req: Request, res: Response, next: NextFunction) => {
  res.json({
    name: packageJson.name,
    version: packageJson.version,
    timestamp: new Date().toISOString(),
  });
  return next();
});

router.get('/ping', async (req: Request, res: Response) => {
  res.status(200).json({ success: true, message: 'pong' });
})

export default router;

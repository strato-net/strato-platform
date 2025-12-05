import { NextFunction, Request, Response } from "express";
import { getRpcUpstream } from "../../config/rpc.config";

class RpcController {
  static async proxy(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const chainId = req.params.chainId;
    const upstream = getRpcUpstream(chainId);

    if (!upstream) {
      res.status(400).json({ error: "Unsupported chainId" });
      return;
    }

    try {
      const upstreamRes = await fetch(upstream, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(req.body),
      });

      const text = await upstreamRes.text();
      res.status(upstreamRes.status);
      res.type(upstreamRes.headers.get("content-type") || "application/json");
      res.send(text);
    } catch (error) {
      next(error);
    }
  }
}

export default RpcController;


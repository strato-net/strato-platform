import { NextFunction, Request, Response } from "express";
import { getRpcUpstream } from "../../config/rpc.config";

class RpcController {
  static async proxy(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const chainId = req.params.chainId;
    const {upstream, fallback} = getRpcUpstream(chainId);

    if (!upstream || !fallback) {
      res.status(400).json({ error: "Unsupported chainId" });
      return;
    }

    try {
      const requestPayload = {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(req.body),
      };

      // Proxy request to upstream RPC provider
      let response;
      try {
        const upstreamRes = await fetch(upstream, {...requestPayload, signal: AbortSignal.timeout(5000)});
        response = await upstreamRes.json();
        if (!upstreamRes.ok || !response.result) throw new Error(); //fallback
        res.status(upstreamRes.status).json(response);
        return;
      }

      // If upstream RPC provider fails, use fallback RPC provider
      catch (error) {
        console.log("RPC error; using fallback. Error:", error, "Request:", req.body, "Response:", response);
        const fallbackRes = await fetch(fallback, requestPayload);
        res.status(fallbackRes.status).json(await fallbackRes.json());
      }
    } catch (error) {
      next(error);
    }
  }
}

export default RpcController;


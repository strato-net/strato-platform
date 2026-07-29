import { NextFunction, Request, Response } from "express";
import { getRpcUpstream } from "../../config/rpc.config";
import { eth, bloc } from "../../utils/appApiHelper";
import { StratoPaths } from "../../config/constants";

class RpcController {
  private static readonly READ_ONLY_RPC_METHODS = new Set([
    "eth_call",
    "eth_getBalance",
    "eth_blockNumber",
    "eth_chainId",
    "eth_getCode",
    "eth_getTransactionCount",
    "eth_getTransactionByHash",
    "eth_getTransactionReceipt",
    "eth_getBlockByNumber",
    "eth_getBlockByHash",
    "eth_getLogs",
    "net_version",
  ]);

  private static isReadOnlyRpcPayload(payload: unknown): boolean {
    const requests = Array.isArray(payload) ? payload : [payload];
    return requests.every(
      (request) =>
        request &&
        typeof request === "object" &&
        "method" in request &&
        typeof request.method === "string" &&
        RpcController.READ_ONLY_RPC_METHODS.has(request.method),
    );
  }

  static async submitSignedTx(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await eth.post(req.accessToken!, "/transaction", req.body);
      res.status(200).json(result.data);
    } catch (error) {
      next(error);
    }
  }

  static async txResults(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await bloc.post(req.accessToken!, StratoPaths.result, req.body);
      res.status(200).json(result.data);
    } catch (error) {
      next(error);
    }
  }

  static async proxy(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const chainId = req.params.chainId;
    const {upstream, fallback} = getRpcUpstream(chainId);

    if (!RpcController.isReadOnlyRpcPayload(req.body)) {
      res.status(403).json({ error: "RPC method not allowed" });
      return;
    }

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
        if (!upstreamRes.ok || (!Array.isArray(response) && response.error)) throw new Error(); //fallback
        res.status(upstreamRes.status).json(response);
        return;
      }

      // If upstream RPC provider fails, use fallback RPC provider
      catch (error) {
        console.log("RPC error; using fallback.");
        const fallbackRes = await fetch(fallback, requestPayload);
        const contentType = fallbackRes.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          const text = await fallbackRes.text();
          console.error("RPC fallback returned non-JSON:", text.slice(0, 200));
          res.status(502).json({ error: "RPC upstream returned non-JSON response" });
          return;
        }
        res.status(fallbackRes.status).json(await fallbackRes.json());
      }
    } catch (error) {
      next(error);
    }
  }
}

export default RpcController;

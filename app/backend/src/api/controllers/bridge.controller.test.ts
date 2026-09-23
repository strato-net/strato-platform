import assert from "node:assert/strict";
import test from "node:test";
import BridgeController, { TradeBridgeController } from "./bridge.controller";
import bridgeRouter from "../routes/bridge.routes";
import tradeRouter from "../routes/trade.routes";
import * as service from "../services/bridge.service";
import * as userService from "../services/user.service";

test("bridge endpoints bind their protocol server-side for every operation", async (t) => {
  const calls: Array<{ method: string; args: any[] }> = [];
  for (const method of ["getNetworkConfigs", "getBridgeableTokens", "getDepositActions", "getBridgeTransactions", "getWithdrawalSummary", "requestWithdrawal", "requestNativeWithdrawal"] as const) {
    t.mock.method(service, method, async (...args: any[]) => { calls.push({ method, args }); return [] as any; });
  }
  t.mock.method(userService, "isUserAdmin", async () => false);
  const next = (error?: any) => { if (error) throw error; };
  const response = { json: () => {} } as any;
  for (const [controller, protocol] of [[BridgeController, "legacy"], [TradeBridgeController, "external"]] as const) {
    const req: any = { accessToken: "token", address: "1".repeat(40), params: { chainId: "1", type: "deposit" }, query: {} };
    for (const handler of ["getNetworkConfigs", "getBridgeableTokens", "getDepositActions", "getTransactions", "getWithdrawalSummary"] as const) {
      await controller[handler](req, response, next);
      assert.equal(calls.at(-1)?.args.at(-1), protocol, handler);
    }
    req.body = { externalChainId: "1", externalToken: "2".repeat(40), stratoToken: "3".repeat(40), stratoTokenAmount: "100", externalRecipient: "4".repeat(40) };
    await controller.requestWithdrawal(req, response, next);
    assert.equal(calls.at(-1)?.args.at(-1), protocol);
    delete req.body.externalToken;
    await controller.requestNativeWithdrawal(req, response, next);
    assert.equal(calls.at(-1)?.args.at(-1), protocol);
  }
  for (const [router, prefix, controller] of [[bridgeRouter, "", BridgeController], [tradeRouter, "/bridge", TradeBridgeController]] as const) {
    for (const [path, handler] of [["/networkConfigs", "getNetworkConfigs"], ["/bridgeableTokens/:chainId", "getBridgeableTokens"], ["/depositActions", "getDepositActions"], ["/transactions/:type", "getTransactions"], ["/withdrawalSummary", "getWithdrawalSummary"], ["/requestWithdrawal", "requestWithdrawal"], ["/requestNativeWithdrawal", "requestNativeWithdrawal"]] as const) {
      const registered = router.stack.find((layer: any) => layer.route?.path === prefix + path)?.route;
      assert.ok(registered);
      assert.equal(registered.stack.at(-1)?.handle, controller[handler]);
      assert.ok(registered.stack.length > 1, "authentication middleware remains attached");
    }
  }
});

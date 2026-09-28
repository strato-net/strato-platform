import assert from "node:assert/strict";
import test from "node:test";
import BridgeController, { TradeBridgeController } from "./bridge.controller";
import bridgeRouter from "../routes/bridge.routes";
import tradeRouter from "../routes/trade.routes";
import * as service from "../services/bridge.service";
import * as reviewService from "../services/bridgeReview.service";
import * as userService from "../services/user.service";

test("bridge review operations reject non-admins and invalid actions before proxying", async t => {
  let admin = false, calls = 0;
  t.mock.method(userService, "isUserAdmin", async () => admin);
  t.mock.method(reviewService, "prepareAdminBridgeReview", async () => { calls++; return { target: "bridge", func: "refundWithdrawal", args: ["2"] }; });
  let status = 200;
  const response = { status: (value: number) => { status = value; return response; }, json: () => {} } as any;
  const request = { method: "POST", accessToken: "test", address: "1".repeat(40), body: { id: "eab:withdrawal:2", action: "refund" } } as any;
  const next = (error?: any) => { if (error) throw error; };
  await BridgeController.reviews(request, response, next);
  assert.equal(status, 403); assert.equal(calls, 0);
  admin = true; request.body.action = "setOwner";
  await BridgeController.reviews(request, response, next);
  assert.equal(status, 400); assert.equal(calls, 0);
  request.body.action = "refund";
  await BridgeController.reviews(request, response, next);
  assert.equal(calls, 1);
  for (const path of ["/admin/reviews", "/admin/reviews/prepare"]) {
    const route = bridgeRouter.stack.find((layer: any) => layer.route?.path === path)?.route;
    assert.ok(route && route.stack.length > 1, "admin review routes require authentication middleware");
  }
});

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

test("processing issues require admin access, bounded paging, and isolate upstream failures", async t => {
  let admin = false, calls = 0, fail = false, status = 200, body: any;
  t.mock.method(userService, "isUserAdmin", async () => admin);
  t.mock.method(service, "getBridgeProcessingIssues", async (state: "active" | "cleared", offset: number, limit: number) => {
    calls++;
    if (fail) throw new Error("secret upstream token and URL");
    return { items: [], total: 0, state, offset, limit, fetchedAt: 1 };
  });
  const req: any = { accessToken: "user-token", address: "1".repeat(40), query: {} };
  const res: any = { status: (value: number) => { status = value; return res; }, json: (value: any) => { body = value; } };
  await BridgeController.processingIssues(req, res);
  assert.equal(status, 403); assert.equal(calls, 0);
  admin = true;
  for (const query of [{ limit: "101" }, { offset: "-1" }, { offset: ["0"] }, { state: "everything" }, { limit: "" }]) {
    req.query = query;
    await BridgeController.processingIssues(req, res);
    assert.equal(status, 400); assert.equal(calls, 0);
  }
  req.query = { state: "cleared", offset: "25", limit: "25" };
  status = 200;
  await BridgeController.processingIssues(req, res);
  assert.equal(body.state, "cleared"); assert.equal(body.offset, 25);
  fail = true;
  await BridgeController.processingIssues(req, res);
  assert.equal(status, 503);
  assert.match(body.error, /Governance reviews and transaction history remain available/);
  assert.doesNotMatch(body.error, /secret|upstream/);
  const route = bridgeRouter.stack.find((layer: any) => layer.route?.path === "/admin/processing-issues")?.route;
  assert.ok(route && route.stack.length > 1);
});

test("Cirrus policy overview is admin-only and never reports failed reads as an empty overview", async t => {
  let admin = false, calls = 0, fail = false, status = 200, body: any;
  t.mock.method(userService, "isUserAdmin", async () => admin);
  t.mock.method(reviewService, "getAdminBridgePolicies", async () => { calls++; if (fail) throw new Error("private diagnostics"); return { items: [], unconfigured: [], fetchedAt: 1 }; });
  const req: any = { accessToken: "token", address: "1".repeat(40) };
  const res: any = { status: (value: number) => { status = value; return res; }, json: (value: any) => { body = value; } };
  await BridgeController.policies(req, res);
  assert.equal(status, 403); assert.equal(calls, 0);
  admin = true;
  await BridgeController.policies(req, res);
  assert.deepEqual(body.items, []);
  fail = true;
  await BridgeController.policies(req, res);
  assert.equal(status, 503); assert.equal(body.items, undefined);
  assert.doesNotMatch(body.error, /private diagnostics/);
  const route = bridgeRouter.stack.find((layer: any) => layer.route?.path === "/admin/policies")?.route;
  assert.ok(route && route.stack.length > 1);
});

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
  request.body.action = "settle";
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

test("admin history includes every bridge while personal history retains its protocol and address", async t => {
  let admin = false;
  const calls: any[][] = [];
  t.mock.method(userService, "isUserAdmin", async () => admin);
  t.mock.method(service, "getBridgeTransactions", async (...args: any[]) => {
    calls.push(args); return { data: [], totalCount: 0 };
  });
  const address = "1".repeat(40);
  const response = { json: () => {} } as any;
  const next = (error?: any) => { if (error) throw error; };
  for (const [controller, protocol] of [[BridgeController, "legacy"], [TradeBridgeController, "external"]] as const) {
    for (const type of ["deposit", "withdrawal"]) {
      for (admin of [false, true]) {
        for (const context of [undefined, "admin"]) {
          const request = { accessToken: "token", address, params: { type }, query: { context, limit: "10" } } as any;
          await controller.getTransactions(request, response, next);
          const adminHistory = admin && context === "admin";
          assert.deepEqual(calls.at(-1), ["token", type, adminHistory ? undefined : address, { limit: "10" }, adminHistory ? "all" : protocol]);
        }
      }
    }
  }
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


test("bridge admin routes bind identity to OAuth, never the wallet header", async t => {
  const auth = await import("../../utils/authHelper");
  const { requestContext } = await import("../../utils/requestContext");
  const admin = "a".repeat(40), user = "b".repeat(40);
  let principal = user, calls = 0;
  t.mock.method(auth, "getServiceToken", async () => { throw new Error("Admin routes must not use service identity"); });
  t.mock.method(auth, "verifyAccessTokenSignature", async (token: string) => {
    if (token === "invalid") throw new Error("invalid token");
    return { preferred_username: "test" };
  });
  t.mock.method(auth, "createOrGetKey", async () => ({ address: principal, isNew: false }));
  t.mock.method(userService, "isUserAdmin", async (_token: string, address: string) => {
    assert.equal(address, principal);
    assert.equal(requestContext.getStore()?.externalSigning, undefined);
    return address === admin;
  });
  t.mock.method(reviewService, "getAdminBridgePolicies", async () => { calls++; return [] as any; });
  t.mock.method(reviewService, "getAdminBridgeReviews", async () => { calls++; return [] as any; });
  t.mock.method(reviewService, "prepareAdminBridgeReview", async () => { calls++; return {} as any; });
  for (const path of ["/admin/policies", "/admin/reviews", "/admin/reviews/prepare"]) {
    const route = bridgeRouter.stack.find((layer: any) => layer.route?.path === path)!.route!;
    const middleware = route.stack[0].handle, controller = route.stack[1].handle;
    for (const scenario of ["anonymous", "invalid", "nonadmin", "admin"]) {
      principal = scenario === "admin" ? admin : user;
      let status = 200, entered = false;
      const req: any = { method: path.endsWith("prepare") ? "POST" : "GET",
        headers: { "x-wallet-address": "0x" + (scenario === "admin" ? user : admin),
          ...(scenario === "anonymous" ? {} : { authorization: "Bearer " + (scenario === "invalid" ? "invalid" : "valid") }) },
        body: { id: "eab:withdrawal:1", action: "refund" } };
      const res: any = { set: () => res, status: (n: number) => { status = n; return res; }, json: () => res };
      const before = calls;
      await middleware(req, res, (error?: any) => { if (!error) entered = true; });
      if (entered) await controller(req, res, (error?: any) => { if (error) throw error; });
      assert.equal(status, scenario === "admin" ? 200 : scenario === "nonadmin" ? 403 : 401);
      assert.equal(calls - before, scenario === "admin" ? 1 : 0);
    }
  }
});

test("ordinary wallet transaction preparation retains external signing context", async t => {
  const auth = await import("../../utils/authHelper");
  const { requestContext } = await import("../../utils/requestContext");
  const { default: AuthHandler } = await import("../middleware/authHandler");
  t.mock.method(auth, "getServiceToken", async () => "service");
  t.mock.method(auth, "verifyAccessTokenSignature", async () => ({ preferred_username: "service" }));
  const address = "a".repeat(40);
  const req: any = { method: "POST", headers: { "x-wallet-address": "0x" + address } };
  let entered = false;
  await AuthHandler.authorizeRequest({ allowWalletAuth: true })(req, {} as any, (error?: any) => {
    if (error) throw error;
    entered = true;
    assert.equal(req.address, address);
    assert.equal(requestContext.getStore()?.externalSigning, true);
  });
  assert.equal(entered, true);
});

test("personal bridge history requires verified identity and ignores supplied account filters", async t => {
  const auth = await import("../../utils/authHelper");
  const account = "a".repeat(40), other = "b".repeat(40);
  t.mock.method(auth, "getServiceToken", async () => { throw new Error("History must not use anonymous service identity"); });
  t.mock.method(auth, "verifyAccessTokenSignature", async () => ({ preferred_username: "user" }));
  t.mock.method(auth, "createOrGetKey", async () => ({ address: account, isNew: false }));
  t.mock.method(userService, "isUserAdmin", async () => false);
  const reads = t.mock.method(service, "getBridgeTransactions", async (_token: string, _type: any, address: any) => {
    assert.equal(address, account);
    return { data: [], totalCount: 0 };
  });
  for (const [router, path] of [[tradeRouter, "/bridge/transactions/:type"], [bridgeRouter, "/transactions/:type"]] as const) {
    const route = router.stack.find((layer: any) => layer.route?.path === path)!.route!;
    for (const authenticated of [false, true]) {
      let status = 200, entered = false;
      const req: any = { method: "GET", headers: { "x-wallet-address": other,
        ...(authenticated ? { authorization: "Bearer valid" } : {}) }, params: { type: "deposit" }, query: { context: "admin" } };
      const res: any = { set: () => res, status: (n: number) => { status = n; return res; }, json: () => res };
      const before = reads.mock.callCount();
      await route.stack[0].handle(req, res, (error?: any) => { if (error) throw error; entered = true; });
      if (entered) await route.stack[1].handle(req, res, (error?: any) => { if (error) throw error; });
      assert.equal(status, authenticated ? 200 : 401);
      assert.equal(reads.mock.callCount() - before, authenticated ? 1 : 0);
    }
  }
  for (const controller of [BridgeController, TradeBridgeController]) {
    let status = 200;
    const res: any = { status: (n: number) => { status = n; return res; }, json: () => res };
    const before = reads.mock.callCount();
    await controller.getTransactions({ accessToken: "service", params: { type: "deposit" }, query: {} } as any, res, error => { if (error) throw error; });
    assert.equal(status, 401);
    assert.equal(reads.mock.callCount(), before);
  }
});


test("admin review prepare route accepts withdrawal cancellation actions", async t => {
  const auth = await import("../../utils/authHelper");
  const account = "a".repeat(40);
  t.mock.method(auth, "verifyAccessTokenSignature", async () => ({ preferred_username: "admin" }));
  t.mock.method(auth, "createOrGetKey", async () => ({ address: account, isNew: false }));
  t.mock.method(userService, "isUserAdmin", async () => true);
  const prepared = { target: "bridge", func: "governanceAction", args: ["17"] };
  const prepare = t.mock.method(reviewService, "prepareAdminBridgeReview", async () => prepared);
  const route = bridgeRouter.stack.find((layer: any) => layer.route?.path === "/admin/reviews/prepare")!.route!;
  for (const action of ["cancel_withdrawal", "confirm_cancellation", "settle", "setOwner"]) {
    let status = 200, body: any, entered = false;
    const req: any = { method: "POST", headers: { authorization: "Bearer valid" },
      body: { id: "native:withdrawal:17", action } };
    const res: any = { set: () => res, status: (n: number) => { status = n; return res; }, json: (value: any) => { body = value; return res; } };
    const before = prepare.mock.callCount();
    await route.stack[0].handle(req, res, (error?: any) => { if (error) throw error; entered = true; });
    assert.equal(entered, true);
    await route.stack[1].handle(req, res, (error?: any) => { if (error) throw error; });
    const valid = action === "cancel_withdrawal" || action === "confirm_cancellation";
    assert.equal(status, valid ? 200 : 400);
    assert.equal(prepare.mock.callCount() - before, valid ? 1 : 0);
    if (valid) {
      assert.deepEqual(prepare.mock.calls.at(-1)?.arguments, ["valid", "native:withdrawal:17", action]);
      assert.deepEqual(body, prepared);
    }
  }
});


test("cancellation eligibility requires verified identity and ignores a spoofed wallet header", async t => {
  const auth = await import("../../utils/authHelper");
  const account = "a".repeat(40), other = "b".repeat(40);
  t.mock.method(auth, "getServiceToken", async () => { throw new Error("Eligibility must not use anonymous service identity"); });
  t.mock.method(auth, "verifyAccessTokenSignature", async (token: string) => {
    if (token === "invalid") throw new Error("Invalid token");
    return { preferred_username: "user" };
  });
  t.mock.method(auth, "createOrGetKey", async () => ({ address: account, isNew: false }));
  const reads = t.mock.method(service, "getWithdrawalCancellation", async (...args: any[]) => {
    assert.deepEqual(args, ["valid", "native", "17", account]);
    return { eligible: false } as any;
  });
  const route = bridgeRouter.stack.find((layer: any) => layer.route?.path === "/withdrawalCancellation" && layer.route.methods.get)!.route!;
  for (const token of [undefined, "invalid", "valid"]) {
    let status = 200, entered = false;
    const req: any = { method: "GET", headers: { "x-wallet-address": other,
      ...(token ? { authorization: `Bearer ${token}` } : {}) }, query: { source: "native", withdrawalId: "17" } };
    const res: any = { set: () => res, status: (n: number) => { status = n; return res; }, json: () => res };
    const before = reads.mock.callCount();
    await route.stack[0].handle(req, res, (error?: any) => { if (!error) entered = true; });
    if (entered) await route.stack[1].handle(req, res, (error?: any) => { if (error) throw error; });
    assert.equal(status, token === "valid" ? 200 : 401);
    assert.equal(reads.mock.callCount() - before, token === "valid" ? 1 : 0);
  }
});

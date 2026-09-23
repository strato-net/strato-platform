import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Bridge/StratoNativeBridge.sol";

contract NativeRouteCaller {
    function do(address target, string method, variadic args) public returns (variadic) {
        return target.call(method, args);
    }
}

contract NativeFailingRouter {
    bool plain;
    constructor(bool _plain) { plain = _plain; }
    function executeRouteWithActions(address tokenIn, address, uint256 amount, address, RouteStepData[], uint256, uint256) public returns (uint256) {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amount);
        if (plain) revert();
        require(false, "router failed after transfer");
    }
}

contract Describe_NativeDepositRouting is Authorizable {
    using BridgeTypes for *;
    using RouterTypes for *;
    StratoNativeBridge bridge;
    StratoNativeCustodyVault vault;
    Token token;
    SaveUSDSTVault savings;
    TokenRouter router;
    NativeRouteCaller user;
    address externalBridge = address(0x3333);
    address representation = address(0x4444);

    function beforeAll() { bypassAuthorizations = true; }

    function beforeEach() {
        AdminRegistry registry = new AdminRegistry();
        registry.initialize([address(this)]);
        TokenFactory factory = new TokenFactory(address(registry));
        token = Token(factory.createTokenWithInitialOwner("Native", "N", [], [], [], "N", 0, 18, address(registry)));
        token.setStatus(2);
        token.mint(address(this), 1000);
        bridge = new StratoNativeBridge(address(this));
        vault = new StratoNativeCustodyVault(address(this));
        vault.initialize(address(this), address(this));
        token.approve(address(vault), 1000);
        vault.lock(address(token), address(this), 1000);
        vault.setBridge(address(bridge));
        bridge.initialize(address(factory), address(vault), address(this), address(this));
        bridge.setAsset(true, 1, externalBridge, representation, "Native", "N", 1000, 1000, address(token));
        savings = new SaveUSDSTVault(address(this));
        savings.initialize(address(token), "Saved", "sN");
        router = new TokenRouter(address(this));
        FeeCollector fees = new FeeCollector(address(this));
        PoolFactory pools = new PoolFactory(address(this));
        pools.initialize(address(factory), address(registry), address(fees));
        PoolV3Factory v3 = new PoolV3Factory(address(this));
        v3.initialize(address(factory), address(fees));
        DirectMintPSM psm = new DirectMintPSM(address(this));
        Token eligible = Token(factory.createTokenWithInitialOwner("Eligible", "E", [], [], [], "E", 0, 18, address(registry)));
        eligible.setStatus(2);
        psm.initialize(address(token), address(fees), [address(eligible)]);
        PriceOracle oracle = new PriceOracle(address(this));
        oracle.initialize();
        MetalForge forge = new MetalForge(address(this));
        forge.initialize(address(oracle), address(0xdead), address(fees), address(token));
        router.initialize(address(pools), address(v3), address(psm), address(forge), address(savings));
        bridge.setTokenRouter(address(router));
        bridge.setAutoRouteEnabled(address(token), 1, true);
        user = new NativeRouteCaller();
    }

    function steps() internal returns (RouteStep[]) {
        return [RouteStep(RouteAction.SAVE, address(savings), address(token), address(savings), 99, 0, 0, false, 0)];
    }

    function recordRouted(uint256 minimum) internal {
        bridge.recordDepositWithRoute(1, externalBridge, 1, address(user), "abcdef", representation, address(user), 100, address(savings), minimum);
    }

    function assertSettled() internal {
        (BridgeStatus status,,,,,,,,,,) = bridge.getDepositInfo(bridge.getDepositId(1, externalBridge, 1));
        require(status == BridgeStatus.COMPLETED, "not completed");
        require(vault.lockedBalance(address(token)) == 900, "liability not released exactly once");
        require(token.balanceOf(address(bridge)) == 0, "stranded source tokens");
        require(token.allowance(address(bridge), bridge.tokenRouter()) == 0, "stale approval");
    }

    function it_routes_unlocked_tokens_to_the_pinned_recipient() {
        recordRouted(99);
        bridge.confirmDepositWithRoute(1, externalBridge, 1, steps());
        require(savings.balanceOf(address(user)) == 100, "missing route output");
        require(token.balanceOf(address(user)) == 0, "unexpected fallback");
        assertSettled();
    }

    function it_cannot_bypass_routing_through_plain_confirmation() {
        recordRouted(99);
        bool failed = false;
        try bridge.confirmDeposit(1, externalBridge, 1) {} catch { failed = true; }
        require(failed, "plain entry accepted route");
        require(vault.lockedBalance(address(token)) == 1000, "custody changed");
    }

    function it_falls_back_on_unavailable_route() {
        recordRouted(99);
        bridge.confirmDepositWithRoute(1, externalBridge, 1, []);
        require(token.balanceOf(address(user)) == 100, "missing fallback");
        assertSettled();
    }

    function it_falls_back_when_final_output_is_below_user_minimum() {
        recordRouted(101);
        bridge.confirmDepositWithRoute(1, externalBridge, 1, steps());
        require(token.balanceOf(address(user)) == 100, "missing fallback");
        require(savings.balanceOf(address(user)) == 0, "partial output persisted");
        assertSettled();
    }

    function it_rolls_back_router_transfers_before_string_revert_fallback() {
        NativeFailingRouter failing = new NativeFailingRouter(false);
        bridge.setTokenRouter(address(failing));
        recordRouted(99);
        bridge.confirmDepositWithRoute(1, externalBridge, 1, steps());
        require(token.balanceOf(address(failing)) == 0, "router transfer persisted");
        require(token.balanceOf(address(user)) == 100, "missing fallback");
        assertSettled();
    }

    function it_rolls_back_router_transfers_before_plain_revert_fallback() {
        NativeFailingRouter failing = new NativeFailingRouter(true);
        bridge.setTokenRouter(address(failing));
        recordRouted(99);
        bridge.confirmDepositWithRoute(1, externalBridge, 1, steps());
        require(token.balanceOf(address(failing)) == 0, "router transfer persisted");
        require(token.balanceOf(address(user)) == 100, "missing fallback");
        assertSettled();
    }

    function it_does_not_swallow_custody_failures() {
        recordRouted(99);
        vault.setPause(true);
        bool failed = false;
        try bridge.confirmDepositWithRoute(1, externalBridge, 1, steps()) {} catch { failed = true; }
        require(failed, "custody failure swallowed");
        (BridgeStatus status,,,,,,,,,,) = bridge.getDepositInfo(bridge.getDepositId(1, externalBridge, 1));
        require(status == BridgeStatus.INITIATED, "settlement persisted");
        require(vault.lockedBalance(address(token)) == 1000, "liability changed");
    }

    function it_rejects_replay_and_nonoperator_confirmation() {
        recordRouted(99);
        bool failed = false;
        try user.do(address(bridge), "confirmDepositWithRoute", 1, externalBridge, 1, steps()) {} catch { failed = true; }
        require(failed, "nonoperator accepted");
        bridge.confirmDepositWithRoute(1, externalBridge, 1, steps());
        failed = false;
        try bridge.confirmDepositWithRoute(1, externalBridge, 1, steps()) {} catch { failed = true; }
        require(failed, "replay accepted");
        assertSettled();
    }

    function it_preserves_plain_native_redemptions() {
        bridge.setAutoRouteEnabled(address(token), 1, false);
        bridge.recordDeposit(1, externalBridge, 1, address(user), "abcdef", representation, address(user), 100);
        bridge.confirmDeposit(1, externalBridge, 1);
        require(token.balanceOf(address(user)) == 100, "missing plain deposit");
        assertSettled();
    }

    function it_defaults_new_routes_to_disabled_and_isolates_chain_permissions() {
        bridge.setAsset(true, 2, externalBridge, representation, "Native", "N", 1000, 1000, address(token));
        require(!bridge.autoRouteEnabled(address(token), 2), "new route enabled by default");
        require(!bridge.autoRouteEnabled(address(savings), 1), "permission leaked to another token");
        bridge.recordDepositWithRoute(2, externalBridge, 1, address(user), "abcdef", representation, address(user), 100, address(savings), 99);
        bridge.confirmDepositWithRoute(2, externalBridge, 1, steps());
        require(token.balanceOf(address(user)) == 100, "disabled route did not fall back");
        require(savings.balanceOf(address(user)) == 0, "disabled route executed");
        require(bridge.autoRouteEnabled(address(token), 1), "other chain permission changed");
        require(vault.lockedBalance(address(token)) == 900, "custody not settled");
    }

    function it_falls_back_if_permission_is_revoked_after_recording() {
        recordRouted(99);
        bridge.setAutoRouteEnabled(address(token), 1, false);
        bridge.confirmDepositWithRoute(1, externalBridge, 1, steps());
        require(token.balanceOf(address(user)) == 100, "missing fallback");
        require(savings.balanceOf(address(user)) == 0, "revoked route executed");
        assertSettled();
    }

    function it_restricts_permission_changes_to_owner_and_valid_routes() {
        bool failed = false;
        try user.do(address(bridge), "setAutoRouteEnabled", address(token), 1, false) {} catch { failed = true; }
        require(failed && bridge.autoRouteEnabled(address(token), 1), "nonowner changed permission");
        failed = false;
        try bridge.setAutoRouteEnabled(address(token), 2, true) {} catch { failed = true; }
        require(failed, "missing route enabled");
        bridge.setAsset(false, 1, externalBridge, representation, "Native", "N", 1000, 1000, address(token));
        failed = false;
        try bridge.setAutoRouteEnabled(address(token), 1, true) {} catch { failed = true; }
        require(failed, "disabled asset enabled for routing");
        bridge.setAutoRouteEnabled(address(token), 1, false);
        require(!bridge.autoRouteEnabled(address(token), 1), "could not revoke disabled asset");
    }

    function it_requires_initialized_router_before_enabling() {
        TokenRouter uninitialized = new TokenRouter(address(this));
        bridge.setAutoRouteEnabled(address(token), 1, false);
        bridge.setTokenRouter(address(uninitialized));
        bool failed = false;
        try bridge.setAutoRouteEnabled(address(token), 1, true) {} catch { failed = true; }
        require(failed && !bridge.autoRouteEnabled(address(token), 1), "uninitialized router enabled");
    }
    function it_preserves_pinned_intent_through_review_and_rejects_duplicate_recording() {
        recordRouted(99);
        bool failed = false;
        try bridge.recordDepositWithRoute(1, externalBridge, 1, address(user), "abcdef", representation, address(user), 100, address(token), 1) {} catch { failed = true; }
        require(failed, "duplicate intent accepted");
        bridge.reviewDeposit(1, externalBridge, 1);
        bridge.confirmDepositWithRoute(1, externalBridge, 1, steps());
        require(savings.balanceOf(address(user)) == 100, "review changed intent");
        assertSettled();
    }

    function it_obeys_deposit_pause_and_rolls_back_wrong_output_routes() {
        recordRouted(99);
        bridge.setPause(true, false);
        bool failed = false;
        try bridge.confirmDepositWithRoute(1, externalBridge, 1, steps()) {} catch { failed = true; }
        require(failed, "deposit pause bypassed");
        require(vault.lockedBalance(address(token)) == 1000, "paused settlement changed custody");
        bridge.setPause(false, false);
        RouteStep[] wrong = [RouteStep(RouteAction.SAVE, address(savings), address(token), address(token), 99, 0, 0, false, 0)];
        bridge.confirmDepositWithRoute(1, externalBridge, 1, wrong);
        require(token.balanceOf(address(user)) == 100, "wrong-output route did not fall back");
        assertSettled();
    }

}

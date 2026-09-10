import "../../concrete/YieldVault/YieldVault.sol";
import "../../abstract/ERC20/ERC20.sol";

// Lightweight, self-contained harness for the permissionless protocol-fee sweep.
// Imports only YieldVault (not BaseCodeCollection), so it compiles without the
// full contract graph. The vault reads the oracle by casting the configured
// address to PriceOracle and calling exchangeRates()/getAssetPrice(); MockOracle
// matches those selectors, so the cast dispatches to it at runtime.

contract MockToken is ERC20 {
    constructor(string n, string s) ERC20(n, s) {}
    function mint(address to, uint amt) external { _mint(to, amt); }
}

contract MockOracle {
    mapping(address => uint256) public exRate; // yieldToken -> asset, 1e18-scaled
    mapping(address => uint256) public px;      // USD price, 1e8-scaled

    function setRate(address a, uint256 v) external { exRate[a] = v; }
    function setPrice(address a, uint256 v) external { px[a] = v; }

    function exchangeRates(address a) external view returns (uint256) { return exRate[a]; }
    function getAssetPrice(address a) external view returns (uint256) {
        require(px[a] > 0, "Price not available");
        return px[a];
    }
}

contract Actor {
    function approve(address token, address spender, uint amt) external {
        ERC20(token).approve(spender, amt);
    }
    function do(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

contract Describe_YieldVaultSweep {
    uint INF = 2 ** 256 - 1;
    uint WAD = 1e18;
    address DEFAULT_FEE_COLLECTOR = address(0x000000000000000000000000000000000000100d);

    YieldVault vault;
    MockToken asset; // "ETH" (vault asset)
    MockToken wst;   // "wstETH" (yield token)
    MockOracle oracle;
    Actor strat;
    Actor fc;

    function beforeEach() public {
        asset = new MockToken("ETH", "ETH");
        wst = new MockToken("wstETH", "wstETH");
        oracle = new MockOracle();
        vault = new YieldVault(address(this));
        vault.initialize(address(asset), "ETH Carry Vault", "carryETH");
        strat = new Actor();
        fc = new Actor();
        vault.setStrategyApproval(address(strat), true);
        vault.setStrategyYieldToken(address(strat), address(wst));
        vault.setPriceOracle(address(oracle));
        vault.setFeeCollector(address(fc));
    }

    // Deploy `principal` ETH to strat as tracked debt, seed strat with `wstAmt`
    // wstETH, wire oracle (redemption `rate` + market USD prices), approve vault.
    function _setup(uint principal, uint wstAmt, uint rate, uint pWst, uint pEth) internal {
        asset.mint(address(this), principal);
        asset.approve(address(vault), INF);
        vault.deposit(principal, address(this));
        vault.deployCapital(address(strat), principal);
        oracle.setRate(address(wst), rate);
        if (pWst > 0) oracle.setPrice(address(wst), pWst);
        if (pEth > 0) oracle.setPrice(address(asset), pEth);
        wst.mint(address(strat), wstAmt);
        strat.approve(address(wst), address(vault), INF);
    }

    // Market ratio == redemption rate (peg holds) so the floor never binds.
    function _setupPegged(uint principal, uint wstAmt, uint rate) internal {
        _setup(principal, wstAmt, rate, rate / 1e10, 1e8);
    }

    // ---------------------------------------------------------------------
    // Config / setters
    // ---------------------------------------------------------------------

    function it_setFeeCollector_updates() public {
        vault.setFeeCollector(address(0xBEEF));
        require(vault.feeCollector() == address(0xBEEF), "fee collector set");
    }

    function it_setFeeCollector_rejects_the_vault_address() public {
        bool reverted = false;
        try vault.setFeeCollector(address(vault)) {} catch { reverted = true; }
        require(reverted, "feeCollector=vault should revert");
    }

    function it_setSweepBuffer_updates() public {
        vault.setSweepBuffer(7e18);
        require(vault.sweepBuffer() == 7e18, "buffer set");
    }

    function it_setPriceOracle_updates() public {
        vault.setPriceOracle(address(0xCAFE));
        require(vault.priceOracle() == address(0xCAFE), "oracle set");
    }

    function it_setStrategyYieldToken_rejects_zero_strategy() public {
        bool reverted = false;
        try vault.setStrategyYieldToken(address(0), address(wst)) {} catch { reverted = true; }
        require(reverted, "strategy=0 should revert");
    }

    function it_config_setters_are_owner_only() public {
        Actor outsider = new Actor();
        bool reverted = false;
        try outsider.do(address(vault), "setSweepBuffer(uint256)", 1e18) {} catch { reverted = true; }
        require(reverted, "non-owner setter should revert");
    }

    // ---------------------------------------------------------------------
    // strategySurplus (view math)
    // ---------------------------------------------------------------------

    function it_reports_surplus_above_principal() public {
        _setupPegged(100e18, 84e18, 125e16); // 84 * 1.25 = 105; surplus 5 ETH -> 4 wstETH
        (uint amount, uint holdings, uint rate) = vault.strategySurplus(address(strat));
        require(amount == 4e18, "surplus amount");
        require(holdings == 84e18, "holdings reported");
        require(rate == 125e16, "redemption rate reported");
    }

    function it_respects_the_buffer() public {
        vault.setSweepBuffer(2e18);
        _setupPegged(100e18, 84e18, 125e16); // reserve 102; surplus 3 ETH -> 2.4 wstETH
        (uint amount,,) = vault.strategySurplus(address(strat));
        require(amount == 24e17, "buffered amount");
    }

    function it_returns_zero_at_principal() public {
        _setupPegged(100e18, 80e18, 125e16); // 80 * 1.25 = 100 == principal
        (uint amount,,) = vault.strategySurplus(address(strat));
        require(amount == 0, "no surplus at principal");
    }

    function it_returns_zero_below_principal() public {
        _setupPegged(100e18, 70e18, 125e16); // 70 * 1.25 = 87.5 < 100
        (uint amount,,) = vault.strategySurplus(address(strat));
        require(amount == 0, "no surplus below principal");
    }

    function it_rounds_down_and_never_over_sweeps() public {
        _setupPegged(100e18, 100e18, 11e17); // rate 1.1; value 110; surplus 10 ETH (not divisible)
        (uint amount, uint holdings,) = vault.strategySurplus(address(strat));
        uint sweptValue = (amount * 11e17) / WAD;          // ETH value pulled out
        uint retainedValue = ((holdings - amount) * 11e17) / WAD;
        require(sweptValue <= 10e18, "never sweeps more than the surplus");
        require(retainedValue >= 100e18, "retained holdings still cover principal");
        require(amount < 91e17 && amount > 9e18, "amount ~= 9.09 wstETH, rounded down");
    }

    // ---------------------------------------------------------------------
    // sweepStrategySurplus (behavior)
    // ---------------------------------------------------------------------

    function it_sweeps_and_preserves_nav() public {
        _setupPegged(100e18, 84e18, 125e16);
        uint swept = vault.sweepStrategySurplus(address(strat));
        require(swept == 4e18, "swept 4 wstETH");
        require(wst.balanceOf(address(fc)) == 4e18, "fee collector received");
        require(wst.balanceOf(address(strat)) == 80e18, "strategy retains principal backing");
        require(wst.balanceOf(address(vault)) == 0, "vault never custodies the yield token");
        require(vault.totalAssets() == 100e18, "NAV unchanged");
        require(vault.deployedAssets() == 100e18, "deployed unchanged");
        require(vault.strategyDebt(address(strat)) == 100e18, "debt unchanged");
    }

    function it_sweep_returns_zero_when_no_surplus() public {
        _setupPegged(100e18, 80e18, 125e16);
        require(vault.sweepStrategySurplus(address(strat)) == 0, "no-op sweep");
        require(wst.balanceOf(address(fc)) == 0, "nothing transferred");
    }

    function it_second_sweep_is_noop_after_full_sweep() public {
        _setupPegged(100e18, 84e18, 125e16);
        require(vault.sweepStrategySurplus(address(strat)) == 4e18, "first sweep");
        require(vault.sweepStrategySurplus(address(strat)) == 0, "second sweep is a no-op");
        require(wst.balanceOf(address(fc)) == 4e18, "no double sweep");
    }

    function it_sweep_uses_default_fee_collector_when_unset() public {
        vault.setFeeCollector(address(0)); // 0 => DEFAULT_FEE_COLLECTOR (0x100d)
        _setupPegged(100e18, 84e18, 125e16);
        vault.sweepStrategySurplus(address(strat));
        require(wst.balanceOf(DEFAULT_FEE_COLLECTOR) == 4e18, "swept to default fee collector");
    }

    function it_sweep_is_permissionless() public {
        _setupPegged(100e18, 84e18, 125e16);
        Actor anyone = new Actor(); // not owner, not the strategy
        anyone.do(address(vault), "sweepStrategySurplus(address)", address(strat));
        require(wst.balanceOf(address(fc)) == 4e18, "any caller can trigger the sweep");
    }

    function it_sweep_reverts_when_paused() public {
        _setupPegged(100e18, 84e18, 125e16);
        vault.pause();
        bool reverted = false;
        try vault.sweepStrategySurplus(address(strat)) {} catch { reverted = true; }
        require(reverted, "sweep should revert while paused");
    }

    function it_sweep_reverts_for_unapproved_strategy() public {
        Actor other = new Actor();
        bool reverted = false;
        try vault.sweepStrategySurplus(address(other)) {} catch { reverted = true; }
        require(reverted, "unapproved strategy should revert");
    }

    function it_sweep_reverts_when_allowance_insufficient() public {
        _setupPegged(100e18, 84e18, 125e16);
        strat.approve(address(wst), address(vault), 0); // revoke allowance
        bool reverted = false;
        try vault.sweepStrategySurplus(address(strat)) {} catch { reverted = true; }
        require(reverted, "insufficient allowance should revert");
        require(wst.balanceOf(address(fc)) == 0, "nothing moved");
    }

    function it_sweep_reverts_when_yield_token_unset() public {
        Actor s2 = new Actor();
        vault.setStrategyApproval(address(s2), true); // approved, but no yield token configured
        bool reverted = false;
        try vault.sweepStrategySurplus(address(s2)) {} catch { reverted = true; }
        require(reverted, "unset yield token should revert");
    }

    function it_sweep_reverts_when_exchange_rate_missing() public {
        // strat has a yield token (beforeEach) but the oracle has no redemption rate set
        bool reverted = false;
        try vault.sweepStrategySurplus(address(strat)) {} catch { reverted = true; }
        require(reverted, "missing exchange rate should revert");
    }

    // ---------------------------------------------------------------------
    // Market-price floor
    // ---------------------------------------------------------------------

    function it_floor_does_not_bind_when_pegged() public {
        _setup(100e18, 84e18, 125e16, 125e6, 1e8); // market 1.25 == redemption
        (uint amount,,) = vault.strategySurplus(address(strat));
        require(amount == 4e18, "full redemption surplus when pegged");
    }

    function it_floor_caps_in_a_mild_depeg() public {
        _setup(100e18, 84e18, 125e16, 122e6, 1e8); // market 1.22 < redemption 1.25
        (uint amount,,) = vault.strategySurplus(address(strat));
        require(amount > 2e18 && amount < 21e17, "capped near 2.03 wstETH");
        uint retained = ((84e18 - amount) * 122e6) / 1e8;
        require(retained >= 100e18, "retained covers principal at market");
    }

    function it_floor_blocks_in_a_hard_depeg() public {
        _setup(100e18, 84e18, 125e16, 115e6, 1e8); // 84 * 1.15 = 96.6 < 100 principal
        (uint amount,,) = vault.strategySurplus(address(strat));
        require(amount == 0, "hard depeg blocks the sweep");
        require(vault.sweepStrategySurplus(address(strat)) == 0, "no-op sweep");
        require(wst.balanceOf(address(fc)) == 0, "nothing swept in a depeg");
    }

    function it_floor_does_not_raise_on_market_premium() public {
        _setup(100e18, 84e18, 125e16, 130e6, 1e8); // market 1.30 > redemption 1.25
        (uint amount,,) = vault.strategySurplus(address(strat));
        require(amount == 4e18, "market premium must not increase the sweep");
    }

    function it_fails_closed_without_yield_market_price() public {
        _setup(100e18, 84e18, 125e16, 0, 1e8); // redemption + ETH price, no wstETH USD price
        bool reverted = false;
        try vault.sweepStrategySurplus(address(strat)) {} catch { reverted = true; }
        require(reverted, "missing yield-token market price should revert");
    }

    function it_fails_closed_without_asset_market_price() public {
        _setup(100e18, 84e18, 125e16, 125e6, 0); // redemption + wstETH price, no ETH USD price
        bool reverted = false;
        try vault.sweepStrategySurplus(address(strat)) {} catch { reverted = true; }
        require(reverted, "missing asset market price should revert");
    }
}

// SPDX-License-Identifier: MIT
// CDPEngine unitScale hardening (strato-net/private#175):
//   - unitScale is derived from the token's decimals() at first listing, never taken from calldata
//   - listing requires TokenFactory membership
//   - a reconfigure on an open book cannot move unitScale (and therefore cannot move any CR)
//   - resyncUnitScale is the only re-derivation path and needs pause + zero debt
//   - setSupportedAsset cannot enable an asset that has no config
//
// Standalone harness: this file deliberately does NOT import BaseCodeCollection.sol. It wires the
// CDP stack directly so the suite compiles on solid-vm-cli builds that predate the Staking V2 block
// context. The test contract owns every component, so onlyOwner passes without an AdminRegistry.
import "../../concrete/CDP/CDPEngine.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_CDPUnitScale {
    string[] emptyArray;

    TokenFactory tokenFactory;
    PriceOracle priceOracle;
    FeeCollector feeCollector;
    CDPRegistry cdpRegistry;
    CDPVault cdpVault;
    CDPReserve cdpReserve;
    CDPEngine cdpEngine;
    address usdstAddress;
    address coll18; // 18-decimal factory collateral, listed fresh in beforeEach
    User userA;

    uint256 LR = 150e16;      // 1.5 WAD
    uint256 MIN_CR = 160e16;  // 1.6 WAD
    uint256 PEN = 1000;       // 10%
    uint256 CF = 5000;        // 50%
    uint256 SFR = 1e27;       // RAY: zero stability fee so CR asserts are exact
    uint256 FLOOR = 1e18;     // 1 USDST
    uint256 CEIL = 1000000e18;

    function beforeAll() {
        emptyArray = new string[](0);
        userA = new User();

        tokenFactory = new TokenFactory(address(this));
        priceOracle = new PriceOracle(address(this));
        priceOracle.initialize();
        feeCollector = new FeeCollector(address(this));

        cdpRegistry = new CDPRegistry(address(this));
        cdpVault = new CDPVault(address(this));
        cdpVault.initialize(address(cdpRegistry));
        cdpReserve = new CDPReserve(address(this));
        cdpReserve.initialize(address(cdpRegistry));
        cdpEngine = new CDPEngine(address(this));
        cdpEngine.initialize(address(cdpRegistry));

        usdstAddress = tokenFactory.createToken(
            "USDST", "USD Stablecoin", emptyArray, emptyArray, emptyArray, "USDST", 0, 18
        );
        Token(usdstAddress).setStatus(2); // ACTIVE
        Token(usdstAddress).mint(address(this), 1000000e18);
        Ownable(usdstAddress).transferOwnership(address(cdpEngine)); // engine mints/burns USDST

        cdpRegistry.setAllComponents(
            address(cdpVault),
            address(cdpEngine),
            address(priceOracle),
            usdstAddress,
            address(tokenFactory),
            address(feeCollector),
            address(cdpReserve)
        );
        priceOracle.setAssetPrice(usdstAddress, 1e18);
    }

    function beforeEach() {
        coll18 = _createFactoryToken("C18", 18);
        Token(coll18).mint(address(this), 100000e18);
        _list(coll18, false);
        priceOracle.setAssetPrice(coll18, 5e18); // $5.00 per whole token
    }

    // ───────────────────────────── helpers ─────────────────────────────

    function _createFactoryToken(string sym, uint8 dec) internal returns (address t) {
        t = tokenFactory.createToken(sym, sym, emptyArray, emptyArray, emptyArray, sym, 0, dec);
        Token(t).setStatus(2); // ACTIVE
    }

    function _list(address asset, bool pause) internal {
        cdpEngine.setCollateralAssetParams(asset, LR, MIN_CR, PEN, CF, SFR, FLOOR, CEIL, pause);
    }

    function _unitScaleOf(address asset) internal returns (uint256) {
        (uint256 _lr, uint256 _m, uint256 _p, uint256 _c, uint256 _s, uint256 _f, uint256 _ce, uint256 unit, bool _pa) = cdpEngine.collateralConfigs(asset);
        return unit;
    }

    function _openPosition(address asset, uint256 collateralAmount, uint256 mintUSD) internal {
        require(ERC20(asset).approve(address(cdpVault), collateralAmount), "collateral approve failed");
        cdpEngine.deposit(asset, collateralAmount);
        cdpEngine.mint(asset, mintUSD);
    }

    // ───────────────────── unitScale is derived, never typed ─────────────────────

    function it_derives_unitScale_from_token_decimals_at_first_listing() {
        require(_unitScaleOf(coll18) == 1e18, "18-decimal token must derive unitScale 1e18");

        address c6 = _createFactoryToken("C6", 6);
        _list(c6, false);
        require(_unitScaleOf(c6) == 1e6, "6-decimal token must derive unitScale 1e6");
        require(cdpEngine.isSupportedAsset(c6), "listed asset must be supported");

        address c8 = _createFactoryToken("C8", 8);
        _list(c8, true);
        require(_unitScaleOf(c8) == 1e8, "8-decimal token must derive unitScale 1e8");
    }

    function it_values_low_decimal_collateral_with_the_derived_scale() {
        address c6 = _createFactoryToken("C6", 6);
        Token(c6).mint(address(this), 10000e6);
        _list(c6, false);
        priceOracle.setAssetPrice(c6, 5e18);

        // 1000 whole tokens at $5 = $5000 of collateral against $1000 of debt -> CR 5.0
        _openPosition(c6, 1000e6, 1000e18);
        uint256 cr = cdpEngine.collateralizationRatio(address(this), c6);
        require(cr == 5e18, "6-decimal collateral must be valued through unitScale 1e6 (CR 5.0)");
    }

    function it_rejects_listing_an_address_that_is_not_a_factory_token() {
        Token rogue = new Token(address(this)); // a real Token, but never registered with the factory
        uint256 countBefore = cdpEngine.collateralAssetCount();
        bool reverted = false;
        try {
            cdpEngine.setCollateralAssetParams(address(rogue), LR, MIN_CR, PEN, CF, SFR, FLOOR, CEIL, false);
        } catch {
            reverted = true;
        }
        require(reverted, "listing a non-factory token must revert");
        require(!cdpEngine.isSupportedAsset(address(rogue)), "non-factory token must not become supported");
        require(_unitScaleOf(address(rogue)) == 0, "non-factory token must have no config");
        require(cdpEngine.collateralAssetCount() == countBefore, "non-factory token must not be enumerated");
    }

    // ───────────────────────── open-book protection ─────────────────────────

    function it_reconfigure_on_an_open_book_cannot_move_unitScale_or_any_CR() {
        _openPosition(coll18, 1000e18, 1000e18); // $5000 collateral, $1000 debt
        require(cdpEngine.collateralizationRatio(address(this), coll18) == 5e18, "sanity: CR starts at 5.0");

        // Routine risk tweak on the hot path: LR 1.5 -> 1.7, minCR 1.6 -> 1.8, ceiling doubled.
        // Pre-fix this same call rewrote unitScale from calldata; now there is no such argument.
        cdpEngine.setCollateralAssetParams(coll18, 170e16, 180e16, PEN, CF, SFR, FLOOR, 2000000e18, false);

        (uint256 lr, uint256 mcr, uint256 pen, uint256 cf, uint256 sfr, uint256 fl, uint256 ce, uint256 unit, bool paused) = cdpEngine.collateralConfigs(coll18);
        require(lr == 170e16, "LR must update");
        require(mcr == 180e16, "minCR must update");
        require(ce == 2000000e18, "ceiling must update");
        require(unit == 1e18, "unitScale must be untouched by a reconfigure");
        require(cdpEngine.collateralizationRatio(address(this), coll18) == 5e18, "CR must not move on a reconfigure");
    }

    function it_resyncUnitScale_reverts_while_unpaused() {
        bool reverted = false;
        try {
            cdpEngine.resyncUnitScale(coll18);
        } catch {
            reverted = true;
        }
        require(reverted, "resync must revert while the asset is unpaused");
        require(_unitScaleOf(coll18) == 1e18, "unitScale must be unchanged after a rejected resync");
    }

    function it_resyncUnitScale_reverts_with_debt_outstanding_even_when_paused() {
        _openPosition(coll18, 1000e18, 1000e18);
        cdpEngine.setPaused(coll18, true);
        bool reverted = false;
        try {
            cdpEngine.resyncUnitScale(coll18);
        } catch {
            reverted = true;
        }
        require(reverted, "resync must revert while totalScaledDebt > 0");
        require(_unitScaleOf(coll18) == 1e18, "unitScale must be unchanged after a rejected resync");
        cdpEngine.setPaused(coll18, false);
    }

    function it_resyncUnitScale_succeeds_only_when_paused_with_zero_debt() {
        _openPosition(coll18, 1000e18, 1000e18);
        require(ERC20(usdstAddress).approve(address(cdpEngine), 2000e18), "USDST approve failed");
        cdpEngine.repayAll(coll18);
        (uint256 c, uint256 d) = cdpEngine.vaults(address(this), coll18);
        require(d == 0, "sanity: debt cleared");

        cdpEngine.setPaused(coll18, true);
        cdpEngine.resyncUnitScale(coll18);
        require(_unitScaleOf(coll18) == 1e18, "resync must re-derive 10**decimals");
        cdpEngine.setPaused(coll18, false);
    }

    function it_resyncUnitScale_reverts_for_an_unconfigured_asset() {
        address fresh = _createFactoryToken("FRESH", 18);
        bool reverted = false;
        try {
            cdpEngine.resyncUnitScale(fresh);
        } catch {
            reverted = true;
        }
        require(reverted, "resync of an unconfigured asset must revert");
    }

    // ───────────────────── zero-config state is unreachable ─────────────────────

    function it_setSupportedAsset_cannot_enable_an_unconfigured_asset() {
        address fresh = _createFactoryToken("FRESH", 18);
        bool reverted = false;
        try {
            cdpEngine.setSupportedAsset(fresh, true);
        } catch {
            reverted = true;
        }
        require(reverted, "enabling support for an unconfigured asset must revert");
        require(!cdpEngine.isSupportedAsset(fresh), "unconfigured asset must stay unsupported");

        // Configured assets still toggle both ways
        cdpEngine.setSupportedAsset(coll18, false);
        require(!cdpEngine.isSupportedAsset(coll18), "configured asset can be disabled");
        cdpEngine.setSupportedAsset(coll18, true);
        require(cdpEngine.isSupportedAsset(coll18), "configured asset can be re-enabled");
    }

    // ───────────────────────────── batch setter ─────────────────────────────

    function it_batch_setter_derives_unitScale_per_asset_without_a_unitScales_array() {
        address c6 = _createFactoryToken("C6", 6);
        address c8 = _createFactoryToken("C8", 8);

        address[] memory assets = new address[](2);
        assets[0] = c6;
        assets[1] = c8;
        uint[] memory lrs = new uint[](2);
        lrs[0] = LR;
        lrs[1] = 200e16;
        uint[] memory minCRs = new uint[](2);
        minCRs[0] = MIN_CR;
        minCRs[1] = 210e16;
        uint[] memory pens = new uint[](2);
        pens[0] = PEN;
        pens[1] = PEN;
        uint[] memory cfs = new uint[](2);
        cfs[0] = CF;
        cfs[1] = CF;
        uint[] memory sfrs = new uint[](2);
        sfrs[0] = SFR;
        sfrs[1] = SFR;
        uint[] memory floors = new uint[](2);
        floors[0] = FLOOR;
        floors[1] = FLOOR;
        uint[] memory ceils = new uint[](2);
        ceils[0] = CEIL;
        ceils[1] = CEIL;
        bool[] memory pauses = new bool[](2);
        pauses[0] = false;
        pauses[1] = true;

        cdpEngine.setCollateralAssetParamsBatch(assets, lrs, minCRs, pens, cfs, sfrs, floors, ceils, pauses);

        require(_unitScaleOf(c6) == 1e6, "batch: 6-decimal asset must derive 1e6");
        require(_unitScaleOf(c8) == 1e8, "batch: 8-decimal asset must derive 1e8");
        (uint256 lr8, uint256 m8, uint256 p8, uint256 cf8, uint256 s8, uint256 f8, uint256 ce8, uint256 u8, bool paused8) = cdpEngine.collateralConfigs(c8);
        require(lr8 == 200e16, "batch: i-th LR must land on the i-th asset");
        require(paused8, "batch: i-th pause flag must land on the i-th asset");
    }
}

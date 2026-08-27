import "../../concrete/BaseCodeCollection.sol";
import "../../concrete/Router/TokenRouter.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

contract Describe_TokenRouter is Authorizable {
    using RouterTypes for *;

    uint256 constant Q96 = 79228162514264337593543950336;
    uint256 constant DEADLINE_OFFSET = 3600;
    uint256 constant BIG = 1000000e18;

    Mercata m;
    TokenRouter router;
    DirectMintPSM psm;
    MetalForge forge;
    SaveUSDSTVault saveVault;
    YieldVault yieldVault;
    PriceOracle oracle;
    PoolV3Factory v3Factory;

    Token tokenA;
    Token tokenB;
    Token stableA;
    Token stableB;
    Token v3A;
    Token v3B;
    Token usdst;
    Token gold;

    Pool v2Pool;
    StablePool stablePool;
    PoolV3 v3Pool;

    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
    }

    function beforeEach() {
        tokenA = _createToken("Token A", "TKA");
        tokenB = _createToken("Token B", "TKB");
        stableA = _createToken("Stable A", "STA");
        stableB = _createToken("Stable B", "STB");
        v3A = _createToken("V3 A", "V3A");
        v3B = _createToken("V3 B", "V3B");
        usdst = _createToken("USDST", "USDST");
        gold = _createToken("Gold", "GOLD");

        v2Pool = Pool(m.poolFactory().createPool(address(tokenA), address(tokenB)));
        _whitelistPoolToken(v2Pool.lpToken(), address(v2Pool));
        tokenA.approve(address(v2Pool), BIG);
        tokenB.approve(address(v2Pool), BIG);
        v2Pool.addLiquidity(10000e18, 10000e18, block.timestamp + DEADLINE_OFFSET);

        fastForward(100);
        stablePool = StablePool(m.poolFactory().createStablePool(address(stableA), address(stableB)));
        _whitelistPoolToken(stablePool.lpToken(), address(stablePool));
        stableA.approve(address(stablePool), BIG);
        stableB.approve(address(stablePool), BIG);
        stablePool.addLiquidityGeneral([10000e18, 10000e18], 10000e18, address(this));

        v3Factory = new PoolV3Factory(address(this));
        v3Factory.initialize(address(m.tokenFactory()), address(m.feeCollector()));
        v3Pool = PoolV3(v3Factory.createPoolV3(address(v3A), address(v3B), 3000, Q96));
        v3A.approve(address(v3Pool), BIG);
        v3B.approve(address(v3Pool), BIG);
        v3Pool.mint(address(this), -600, 600, 1000e18, BIG, BIG, block.timestamp + DEADLINE_OFFSET);

        psm = new DirectMintPSM(address(this));
        psm.initialize(address(usdst), address(m.feeCollector()), [address(tokenB)]);
        m.adminRegistry().castVoteOnIssue(
            address(m.adminRegistry()),
            "addWhitelist",
            address(usdst),
            "mint",
            address(psm)
        );

        oracle = new PriceOracle(address(this));
        oracle.initialize();
        oracle.setAssetPrice(address(gold), 100e18);
        forge = new MetalForge(address(this));
        forge.initialize(address(oracle), address(0xdead), address(m.feeCollector()), address(usdst));
        forge.setMetalConfig(address(gold), true, BIG, 0);
        forge.setPayToken(address(usdst), true);
        m.adminRegistry().castVoteOnIssue(
            address(m.adminRegistry()),
            "addWhitelist",
            address(gold),
            "mint",
            address(forge)
        );

        saveVault = new SaveUSDSTVault(address(this));
        saveVault.initialize(address(usdst), "Save USDST", "saveUSDST");

        router = new TokenRouter(address(this));
        router.initialize(
            address(m.poolFactory()),
            address(v3Factory),
            address(psm),
            address(forge),
            address(saveVault)
        );

        yieldVault = new YieldVault(address(this));
        yieldVault.initialize(address(usdst), "USDST Yield Vault", "yvUSDST");
        router.setYieldVault(address(yieldVault), true);
    }

    function _createToken(string name, string symbol) internal returns (Token token) {
        token = Token(m.tokenFactory().createToken(name, name, [], [], [], symbol, 0, 18));
        token.setStatus(2);
        token.mint(address(this), BIG);
    }

    function _whitelistPoolToken(Token lpToken, address pool) internal {
        m.adminRegistry().castVoteOnIssue(
            address(m.adminRegistry()),
            "addWhitelist",
            address(lpToken),
            "mint",
            pool
        );
        m.adminRegistry().castVoteOnIssue(
            address(m.adminRegistry()),
            "addWhitelist",
            address(lpToken),
            "burn",
            pool
        );
    }

    function _factoryPoolIndex(address target) internal returns (uint256) {
        for (uint256 i = 0; i < 1000; i++) {
            try m.poolFactory().allPools(i) returns (address pool) {
                if (pool == target) {
                    return i;
                }
            } catch {
                revert("Factory pool index not found");
            }
        }
        revert("Factory pool index search exceeded");
    }

    function _step(
        RouteAction action,
        address target,
        address tokenIn,
        address tokenOut,
        uint256 minAmountOut,
        uint256 parameter1,
        uint256 parameter2,
        bool direction
    ) internal returns (RouteStep step) {
        step.action = action;
        step.target = target;
        step.tokenIn = tokenIn;
        step.tokenOut = tokenOut;
        step.minAmountOut = minAmountOut;
        step.parameter1 = parameter1;
        step.parameter2 = parameter2;
        step.direction = direction;
    }

    function _stableStep(
        address target,
        address tokenIn,
        address tokenOut,
        uint256 minAmountOut,
        uint256 coinIndexIn,
        uint256 coinIndexOut,
        uint256 factoryPoolIndex
    ) internal returns (RouteStep step) {
        step.action = RouteAction.SWAP_STABLE;
        step.target = target;
        step.tokenIn = tokenIn;
        step.tokenOut = tokenOut;
        step.minAmountOut = minAmountOut;
        step.parameter1 = coinIndexIn;
        step.parameter2 = coinIndexOut;
        step.direction = false;
        step.factoryPoolIndex = factoryPoolIndex;
    }

    function it_initializes_all_dependencies() {
        TokenRouter currentRouter = TokenRouter(address(router));
        require(address(currentRouter.poolFactory()) == address(m.poolFactory()), "Pool factory mismatch");
        require(address(currentRouter.poolV3Factory()) == address(v3Factory), "V3 factory mismatch");
        require(address(currentRouter.directMintPsm()) == address(psm), "PSM mismatch");
        require(address(currentRouter.metalForge()) == address(forge), "Forge mismatch");
        require(address(currentRouter.saveUsdstVault()) == address(saveVault), "Save vault mismatch");
    }

    function it_routes_through_v2_pool() {
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.SWAP_V2,
            address(v2Pool),
            address(tokenA),
            address(tokenB),
            1,
            0,
            0,
            true
        );

        uint256 beforeBalance = Token(address(tokenB)).balanceOf(address(this));
        Token(address(tokenA)).approve(address(router), 100e18);
        uint256 amountOut = router.executeRoute(
            address(tokenA),
            address(tokenB),
            100e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1
        );

        require(amountOut > 0, "No V2 output");
        require(Token(address(tokenB)).balanceOf(address(this)) == beforeBalance + amountOut, "V2 recipient mismatch");
        require(Token(address(tokenA)).balanceOf(address(router)) == 0, "V2 input stranded");
        require(Token(address(tokenB)).balanceOf(address(router)) == 0, "V2 output stranded");
    }

    function it_routes_through_stable_pool() {
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.SWAP_STABLE,
            address(stablePool),
            address(stableA),
            address(stableB),
            1,
            0,
            1,
            false
        );

        uint256 beforeBalance = Token(address(stableB)).balanceOf(address(this));
        Token(address(stableA)).approve(address(router), 100e18);
        uint256 amountOut = router.executeRoute(
            address(stableA),
            address(stableB),
            100e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1
        );

        require(amountOut > 0, "No stable output");
        require(Token(address(stableB)).balanceOf(address(this)) == beforeBalance + amountOut, "Stable recipient mismatch");
    }

    function it_routes_through_multi_token_stable_pool() {
        Token stableC = _createToken("Stable C", "STC");
        address[] tokens = [address(stableA), address(stableB), address(stableC)];
        uint[] rateMultipliers = [1e18, 1e18, 1e18];
        uint[] assetTypes = [0, 0, 0];
        address[] oracles = [address(0), address(0), address(0)];
        StablePool multiPool = StablePool(
            m.poolFactory().createMultiTokenStablePool(tokens, rateMultipliers, assetTypes, oracles)
        );
        _whitelistPoolToken(multiPool.lpToken(), address(multiPool));
        stableA.approve(address(multiPool), BIG);
        stableB.approve(address(multiPool), BIG);
        stableC.approve(address(multiPool), BIG);
        multiPool.addLiquidityGeneral([10000e18, 10000e18, 10000e18], 10000e18, address(this));

        uint256 factoryPoolIndex = _factoryPoolIndex(address(multiPool));
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _stableStep(
            address(multiPool),
            address(stableA),
            address(stableC),
            1,
            0,
            2,
            factoryPoolIndex
        );

        uint256 beforeBalance = Token(address(stableC)).balanceOf(address(this));
        Token(address(stableA)).approve(address(router), 100e18);
        uint256 amountOut = router.executeRoute(
            address(stableA),
            address(stableC),
            100e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1
        );

        require(amountOut > 0, "No multi-stable output");
        require(Token(address(stableC)).balanceOf(address(this)) == beforeBalance + amountOut, "Multi-stable recipient mismatch");
    }

    function it_rejects_wrong_factory_pool_index() {
        Token stableC = _createToken("Stable C", "STC");
        address[] tokens = [address(stableA), address(stableB), address(stableC)];
        uint[] rateMultipliers = [1e18, 1e18, 1e18];
        uint[] assetTypes = [0, 0, 0];
        address[] oracles = [address(0), address(0), address(0)];
        StablePool multiPool = StablePool(
            m.poolFactory().createMultiTokenStablePool(tokens, rateMultipliers, assetTypes, oracles)
        );
        _whitelistPoolToken(multiPool.lpToken(), address(multiPool));
        stableA.approve(address(multiPool), BIG);
        stableB.approve(address(multiPool), BIG);
        stableC.approve(address(multiPool), BIG);
        multiPool.addLiquidityGeneral([10000e18, 10000e18, 10000e18], 10000e18, address(this));

        uint256 correctIndex = _factoryPoolIndex(address(multiPool));
        uint256 wrongIndex = correctIndex == 0 ? 1 : 0;
        require(m.poolFactory().allPools(wrongIndex) != address(multiPool), "Wrong index should reference another pool");
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _stableStep(
            address(multiPool),
            address(stableA),
            address(stableC),
            1,
            0,
            2,
            wrongIndex
        );

        uint256 inputBefore = Token(address(stableA)).balanceOf(address(this));
        Token(address(stableA)).approve(address(router), 100e18);
        bool reverted = false;
        try router.executeRoute(
            address(stableA),
            address(stableC),
            100e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Wrong factory pool index should revert");
        require(Token(address(stableA)).balanceOf(address(this)) == inputBefore, "Wrong index input should roll back");
    }

    function it_routes_through_v3_pool() {
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.SWAP_V3,
            address(v3Pool),
            address(v3A),
            address(v3B),
            1,
            0,
            0,
            true
        );

        uint256 beforeBalance = Token(address(v3B)).balanceOf(address(this));
        Token(address(v3A)).approve(address(router), 10e18);
        uint256 amountOut = router.executeRoute(
            address(v3A),
            address(v3B),
            10e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1
        );

        require(amountOut > 0, "No V3 output");
        require(Token(address(v3B)).balanceOf(address(this)) == beforeBalance + amountOut, "V3 recipient mismatch");
    }

    function it_rejects_partial_v3_input_fill() {
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.SWAP_V3,
            address(v3Pool),
            address(v3A),
            address(v3B),
            1,
            0,
            0,
            true
        );

        uint256 inputBefore = Token(address(v3A)).balanceOf(address(this));
        uint256 outputBefore = Token(address(v3B)).balanceOf(address(this));
        Token(address(v3A)).approve(address(router), 10000e18);
        bool reverted = false;
        try router.executeRoute(
            address(v3A),
            address(v3B),
            10000e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Partial V3 fill should revert");
        require(Token(address(v3A)).balanceOf(address(this)) == inputBefore, "V3 input should roll back");
        require(Token(address(v3B)).balanceOf(address(this)) == outputBefore, "V3 output should roll back");
    }

    function it_routes_psm_output_into_forge() {
        RouteStep[] steps = new RouteStep[](2);
        steps[0] = _step(
            RouteAction.PSM_MINT,
            address(psm),
            address(tokenB),
            address(usdst),
            100e18,
            0,
            0,
            false
        );
        steps[1] = _step(
            RouteAction.FORGE,
            address(forge),
            address(usdst),
            address(gold),
            1e18,
            0,
            0,
            false
        );

        uint256 goldBefore = Token(address(gold)).balanceOf(address(this));
        Token(address(tokenB)).approve(address(router), 100e18);
        uint256 amountOut = router.executeRoute(
            address(tokenB),
            address(gold),
            100e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1e18
        );

        require(amountOut == 1e18, "Unexpected gold output");
        require(Token(address(gold)).balanceOf(address(this)) == goldBefore + 1e18, "Gold not delivered");
        require(Token(address(usdst)).balanceOf(address(router)) == 0, "USDST stranded");
    }

    function it_routes_swap_output_through_psm_and_forge() {
        RouteStep[] steps = new RouteStep[](3);
        steps[0] = _step(
            RouteAction.SWAP_V2,
            address(v2Pool),
            address(tokenA),
            address(tokenB),
            1,
            0,
            0,
            true
        );
        steps[1] = _step(
            RouteAction.PSM_MINT,
            address(psm),
            address(tokenB),
            address(usdst),
            1,
            0,
            0,
            false
        );
        steps[2] = _step(
            RouteAction.FORGE,
            address(forge),
            address(usdst),
            address(gold),
            1,
            0,
            0,
            false
        );

        uint256 goldBefore = Token(address(gold)).balanceOf(address(this));
        Token(address(tokenA)).approve(address(router), 100e18);
        uint256 amountOut = router.executeRoute(
            address(tokenA),
            address(gold),
            100e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1
        );

        require(amountOut > 0, "No routed gold output");
        require(Token(address(gold)).balanceOf(address(this)) == goldBefore + amountOut, "Routed gold not delivered");
        require(Token(address(tokenA)).balanceOf(address(router)) == 0, "Initial token stranded");
        require(Token(address(tokenB)).balanceOf(address(router)) == 0, "Swap output stranded");
        require(Token(address(usdst)).balanceOf(address(router)) == 0, "PSM output stranded");
    }

    function it_routes_psm_output_into_save() {
        RouteStep[] steps = new RouteStep[](2);
        steps[0] = _step(
            RouteAction.PSM_MINT,
            address(psm),
            address(tokenB),
            address(usdst),
            50e18,
            0,
            0,
            false
        );
        steps[1] = _step(
            RouteAction.SAVE,
            address(saveVault),
            address(usdst),
            address(saveVault),
            50e18,
            0,
            0,
            false
        );

        Token(address(tokenB)).approve(address(router), 50e18);
        uint256 amountOut = router.executeRoute(
            address(tokenB),
            address(saveVault),
            50e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            50e18
        );

        require(amountOut == 50e18, "Unexpected save output");
        require(SaveUSDSTVault(address(saveVault)).balanceOf(address(this)) == 50e18, "Shares not delivered");
    }

    function it_routes_psm_output_into_yield_vault() {
        RouteStep[] steps = new RouteStep[](2);
        steps[0] = _step(
            RouteAction.PSM_MINT,
            address(psm),
            address(tokenB),
            address(usdst),
            50e18,
            0,
            0,
            false
        );
        steps[1] = _step(
            RouteAction.YIELD_VAULT_DEPOSIT,
            address(yieldVault),
            address(usdst),
            address(yieldVault),
            50e18,
            0,
            0,
            false
        );

        Token(address(tokenB)).approve(address(router), 50e18);
        uint256 amountOut = router.executeRoute(
            address(tokenB),
            address(yieldVault),
            50e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            50e18
        );

        require(amountOut == 50e18, "Unexpected yield vault output");
        require(YieldVault(address(yieldVault)).balanceOf(address(this)) == 50e18, "Yield shares not delivered");
    }

    function it_rejects_step_slippage_and_rolls_back() {
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.SWAP_V2,
            address(v2Pool),
            address(tokenA),
            address(tokenB),
            100e18,
            0,
            0,
            true
        );

        uint256 inputBefore = Token(address(tokenA)).balanceOf(address(this));
        uint256 outputBefore = Token(address(tokenB)).balanceOf(address(this));
        Token(address(tokenA)).approve(address(router), 100e18);
        bool reverted = false;
        try router.executeRoute(
            address(tokenA),
            address(tokenB),
            100e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Step slippage should revert");
        require(Token(address(tokenA)).balanceOf(address(this)) == inputBefore, "Step input should roll back");
        require(Token(address(tokenB)).balanceOf(address(this)) == outputBefore, "Step output should roll back");
    }

    function it_rejects_final_slippage_and_rolls_back() {
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.SWAP_V2,
            address(v2Pool),
            address(tokenA),
            address(tokenB),
            1,
            0,
            0,
            true
        );

        uint256 inputBefore = Token(address(tokenA)).balanceOf(address(this));
        uint256 outputBefore = Token(address(tokenB)).balanceOf(address(this));
        Token(address(tokenA)).approve(address(router), 100e18);
        bool reverted = false;
        try router.executeRoute(
            address(tokenA),
            address(tokenB),
            100e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            100e18
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Final slippage should revert");
        require(Token(address(tokenA)).balanceOf(address(this)) == inputBefore, "Final input should roll back");
        require(Token(address(tokenB)).balanceOf(address(this)) == outputBefore, "Final output should roll back");
    }

    function it_rejects_unregistered_pool_target() {
        Pool roguePool = new Pool(address(this));
        roguePool.initialize(
            address(tokenA),
            address(tokenB),
            address(v2Pool.lpToken()),
            address(m.poolFactory())
        );
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.SWAP_V2,
            address(roguePool),
            address(tokenA),
            address(tokenB),
            1,
            0,
            0,
            true
        );

        uint256 inputBefore = Token(address(tokenA)).balanceOf(address(this));
        Token(address(tokenA)).approve(address(router), 100e18);
        bool reverted = false;
        try router.executeRoute(
            address(tokenA),
            address(tokenB),
            100e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Unregistered pool should revert");
        require(Token(address(tokenA)).balanceOf(address(this)) == inputBefore, "Unregistered input should roll back");
    }

    function it_rejects_routes_while_paused() {
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.SWAP_V2,
            address(v2Pool),
            address(tokenA),
            address(tokenB),
            1,
            0,
            0,
            true
        );

        router.setPaused(true);
        uint256 inputBefore = Token(address(tokenA)).balanceOf(address(this));
        Token(address(tokenA)).approve(address(router), 100e18);
        bool reverted = false;
        try router.executeRoute(
            address(tokenA),
            address(tokenB),
            100e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Paused router should revert");
        require(Token(address(tokenA)).balanceOf(address(this)) == inputBefore, "Paused input should not move");
    }

    function it_applies_psm_and_forge_fees() {
        psm.setMintFeeBps(address(tokenB), 100);
        forge.setFeeBps(address(gold), 200);
        uint256 expectedGold = 970200000000000000;
        RouteStep[] steps = new RouteStep[](2);
        steps[0] = _step(
            RouteAction.PSM_MINT,
            address(psm),
            address(tokenB),
            address(usdst),
            99e18,
            0,
            0,
            false
        );
        steps[1] = _step(
            RouteAction.FORGE,
            address(forge),
            address(usdst),
            address(gold),
            expectedGold,
            0,
            0,
            false
        );

        uint256 goldBefore = Token(address(gold)).balanceOf(address(this));
        uint256 tokenBFeeBefore = Token(address(tokenB)).balanceOf(address(m.feeCollector()));
        uint256 usdstFeeBefore = Token(address(usdst)).balanceOf(address(m.feeCollector()));
        Token(address(tokenB)).approve(address(router), 100e18);
        uint256 amountOut = router.executeRoute(
            address(tokenB),
            address(gold),
            100e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            expectedGold
        );

        require(amountOut == expectedGold, "Fee-adjusted gold mismatch");
        require(Token(address(gold)).balanceOf(address(this)) == goldBefore + expectedGold, "Fee-adjusted gold not delivered");
        require(Token(address(tokenB)).balanceOf(address(m.feeCollector())) == tokenBFeeBefore + 1e18, "PSM fee mismatch");
        require(Token(address(usdst)).balanceOf(address(m.feeCollector())) == usdstFeeBefore + 198e16, "Forge fee mismatch");
    }

    function it_rejects_unapproved_yield_vault() {
        router.setYieldVault(address(yieldVault), false);
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.YIELD_VAULT_DEPOSIT,
            address(yieldVault),
            address(usdst),
            address(yieldVault),
            1,
            0,
            0,
            false
        );

        uint256 inputBefore = Token(address(usdst)).balanceOf(address(this));
        Token(address(usdst)).approve(address(router), 50e18);
        bool reverted = false;
        try router.executeRoute(
            address(usdst),
            address(yieldVault),
            50e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Unapproved yield vault should revert");
        require(Token(address(usdst)).balanceOf(address(this)) == inputBefore, "Yield input should roll back");
        require(YieldVault(address(yieldVault)).balanceOf(address(this)) == 0, "Yield shares should not mint");
    }

    function it_rejects_unexpected_final_token() {
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.SWAP_V2,
            address(v2Pool),
            address(tokenA),
            address(tokenB),
            1,
            0,
            0,
            true
        );

        uint256 inputBefore = Token(address(tokenA)).balanceOf(address(this));
        uint256 outputBefore = Token(address(tokenB)).balanceOf(address(this));
        Token(address(tokenA)).approve(address(router), 100e18);
        bool reverted = false;
        try router.executeRoute(
            address(tokenA),
            address(gold),
            100e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Unexpected final token should revert");
        require(Token(address(tokenA)).balanceOf(address(this)) == inputBefore, "Unexpected input should roll back");
        require(Token(address(tokenB)).balanceOf(address(this)) == outputBefore, "Unexpected output should roll back");
    }

    function it_rejects_discontinuous_routes() {
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.SWAP_V2,
            address(v2Pool),
            address(tokenB),
            address(tokenA),
            1,
            0,
            0,
            false
        );

        Token(address(tokenA)).approve(address(router), 100e18);
        bool reverted = false;
        try router.executeRoute(
            address(tokenA),
            address(tokenA),
            100e18,
            address(this),
            steps,
            block.timestamp + DEADLINE_OFFSET,
            1
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Discontinuous route should revert");
        require(Token(address(tokenA)).balanceOf(address(router)) == 0, "Input should roll back");
    }
}

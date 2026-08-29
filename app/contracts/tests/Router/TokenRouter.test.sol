import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Admin/AdminRegistry.sol";
import "../../concrete/Admin/FeeCollector.sol";
import "../../concrete/Lending/PriceOracle.sol";
import "../../concrete/Metals/MetalForge.sol";
import "../../concrete/Pools/DirectMintPSM.sol";
import "../../concrete/Pools/Pool.sol";
import "../../concrete/Pools/PoolFactory.sol";
import "../../concrete/Pools/PoolV3.sol";
import "../../concrete/Pools/PoolV3Factory.sol";
import "../../concrete/Pools/StablePool.sol";
import "../../concrete/Router/TokenRouter.sol";
import "../../concrete/Savings/SaveUSDSTVault.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../concrete/YieldVault/YieldVault.sol";

contract Describe_TokenRouter is Authorizable {
    using RouterTypes for *;

    uint256 constant BIG = 1000000e18;
    uint256 constant Q96 = 79228162514264337593543950336;

    TokenFactory tokenFactory;
    AdminRegistry adminRegistry;
    FeeCollector feeCollector;
    PoolFactory poolFactory;
    TokenRouter router;
    DirectMintPSM psm;
    MetalForge forge;
    SaveUSDSTVault saveVault;
    PriceOracle oracle;
    PoolV3Factory v3Factory;
    Pool v2Pool;
    StablePool stablePool;
    PoolV3 v3Pool;
    YieldVault yieldVault;
    Token payToken;
    Token usdst;
    Token gold;
    Token tokenA;
    Token tokenB;
    Token stableA;
    Token stableB;
    Token v3A;
    Token v3B;

    function beforeAll() {
        bypassAuthorizations = true;
    }

    function beforeEach() {
        adminRegistry = new AdminRegistry();
        adminRegistry.initialize([address(this)]);
        tokenFactory = new TokenFactory(address(adminRegistry));
        feeCollector = new FeeCollector(address(this));
        poolFactory = new PoolFactory(address(this));
        poolFactory.initialize(
            address(tokenFactory),
            address(adminRegistry),
            address(feeCollector)
        );
        adminRegistry.castVoteOnIssue(
            address(adminRegistry),
            "addWhitelist",
            address(tokenFactory),
            "createTokenWithInitialOwner",
            address(poolFactory)
        );
        payToken = _createToken("Pay Token", "PAY");
        usdst = _createToken("USDST", "USDST");
        gold = _createToken("Gold", "GOLD");
        tokenA = _createToken("Token A", "TKA");
        tokenB = _createToken("Token B", "TKB");
        stableA = _createToken("Stable A", "STA");
        stableB = _createToken("Stable B", "STB");
        v3A = _createToken("V3 A", "V3A");
        v3B = _createToken("V3 B", "V3B");

        v3Factory = new PoolV3Factory(address(this));
        v3Factory.initialize(
            address(tokenFactory),
            address(feeCollector)
        );

        psm = new DirectMintPSM(address(this));
        psm.initialize(
            address(usdst),
            address(feeCollector),
            [address(payToken)]
        );
        adminRegistry.castVoteOnIssue(
            address(adminRegistry),
            "addWhitelist",
            address(usdst),
            "mint",
            address(psm)
        );

        oracle = new PriceOracle(address(this));
        oracle.initialize();
        oracle.setAssetPrice(address(gold), 100e18);
        forge = new MetalForge(address(this));
        forge.initialize(
            address(oracle),
            address(0xdead),
            address(feeCollector),
            address(usdst)
        );
        forge.setMetalConfig(address(gold), true, BIG, 0);
        forge.setPayToken(address(usdst), true);
        adminRegistry.castVoteOnIssue(
            address(adminRegistry),
            "addWhitelist",
            address(gold),
            "mint",
            address(forge)
        );

        saveVault = new SaveUSDSTVault(address(this));
        saveVault.initialize(
            address(usdst),
            "Save USDST",
            "saveUSDST"
        );

        router = new TokenRouter(address(this));
        router.initialize(
            address(poolFactory),
            address(v3Factory),
            address(psm),
            address(forge),
            address(saveVault)
        );
        yieldVault = new YieldVault(address(this));
        yieldVault.initialize(
            address(usdst),
            "USDST Yield Vault",
            "yvUSDST"
        );
        router.setYieldVault(address(yieldVault), true);
    }

    function _createToken(
        string name,
        string symbol
    ) internal returns (Token token) {
        token = Token(
            tokenFactory.createToken(
                name,
                name,
                [],
                [],
                [],
                symbol,
                0,
                18
            )
        );
        token.setStatus(2);
        token.mint(address(this), BIG);
    }

    function _step(
        RouteAction action,
        address target,
        address tokenIn,
        address tokenOut,
        uint256 minAmountOut
    ) internal returns (RouteStep step) {
        step.action = action;
        step.target = target;
        step.tokenIn = tokenIn;
        step.tokenOut = tokenOut;
        step.minAmountOut = minAmountOut;
    }

    function _swapStep(
        RouteAction action,
        address target,
        address tokenIn,
        address tokenOut,
        uint256 parameter1,
        uint256 parameter2,
        bool direction
    ) internal returns (RouteStep step) {
        step.action = action;
        step.target = target;
        step.tokenIn = tokenIn;
        step.tokenOut = tokenOut;
        step.minAmountOut = 1;
        step.parameter1 = parameter1;
        step.parameter2 = parameter2;
        step.direction = direction;
    }

    function _authorizePoolToken(Token lpToken, address pool) internal {
        lpToken.transferOwnership(address(adminRegistry));
        adminRegistry.castVoteOnIssue(
            address(adminRegistry),
            "addWhitelist",
            address(lpToken),
            "mint",
            pool
        );
        adminRegistry.castVoteOnIssue(
            address(adminRegistry),
            "addWhitelist",
            address(lpToken),
            "burn",
            pool
        );
    }

    function _createV2Pool() internal {
        v2Pool = Pool(
            poolFactory.createPool(address(tokenA), address(tokenB))
        );
        _authorizePoolToken(v2Pool.lpToken(), address(v2Pool));
        Token(address(tokenA)).approve(address(v2Pool), BIG);
        Token(address(tokenB)).approve(address(v2Pool), BIG);
        v2Pool.addLiquidity(10000e18, 10000e18, block.timestamp + 3600);
    }

    function _createStablePool() internal {
        fastForward(100);
        stablePool = StablePool(
            poolFactory.createStablePool(address(stableA), address(stableB))
        );
        _authorizePoolToken(stablePool.lpToken(), address(stablePool));
        Token(address(stableA)).approve(address(stablePool), BIG);
        Token(address(stableB)).approve(address(stablePool), BIG);
        stablePool.addLiquidityGeneral(
            [10000e18, 10000e18],
            10000e18,
            address(this)
        );
    }

    function _createV3Pool() internal {
        v3Pool = PoolV3(
            v3Factory.createPoolV3(
                address(v3A),
                address(v3B),
                3000,
                Q96
            )
        );
        Token(address(v3A)).approve(address(v3Pool), BIG);
        Token(address(v3B)).approve(address(v3Pool), BIG);
        v3Pool.mint(
            address(this),
            -600,
            600,
            1000e18,
            BIG,
            BIG,
            block.timestamp + 3600
        );
    }

    function it_routes_through_v2_pool() {
        _createV2Pool();
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _swapStep(
            RouteAction.SWAP_V2,
            address(v2Pool),
            address(tokenA),
            address(tokenB),
            0,
            0,
            true
        );

        Token(address(tokenA)).approve(address(router), 100e18);
        uint256 amountOut = router.executeRoute(
            address(tokenA),
            address(tokenB),
            100e18,
            address(this),
            steps,
            block.timestamp + 300,
            1
        );
        require(amountOut > 0, "No V2 output");
    }

    function it_routes_through_stable_pool() {
        _createStablePool();
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _swapStep(
            RouteAction.SWAP_STABLE,
            address(stablePool),
            address(stableA),
            address(stableB),
            0,
            1,
            false
        );

        Token(address(stableA)).approve(address(router), 100e18);
        uint256 amountOut = router.executeRoute(
            address(stableA),
            address(stableB),
            100e18,
            address(this),
            steps,
            block.timestamp + 300,
            1
        );
        require(amountOut > 0, "No stable output");
    }

    function it_routes_through_v3_pool() {
        _createV3Pool();
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _swapStep(
            RouteAction.SWAP_V3,
            address(v3Pool),
            address(v3A),
            address(v3B),
            4295128740,
            0,
            true
        );

        Token(address(v3A)).approve(address(router), 10e18);
        uint256 amountOut = router.executeRoute(
            address(v3A),
            address(v3B),
            10e18,
            address(this),
            steps,
            block.timestamp + 300,
            1
        );
        require(amountOut > 0, "No V3 output");
    }

    function it_routes_into_an_approved_yield_vault() {
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.YIELD_VAULT_DEPOSIT,
            address(yieldVault),
            address(usdst),
            address(yieldVault),
            50e18
        );

        Token(address(usdst)).approve(address(router), 50e18);
        uint256 amountOut = router.executeRoute(
            address(usdst),
            address(yieldVault),
            50e18,
            address(this),
            steps,
            block.timestamp + 300,
            50e18
        );
        require(amountOut == 50e18, "Unexpected yield vault output");
    }

    function it_routes_into_save_usdst() {
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.SAVE,
            address(saveVault),
            address(usdst),
            address(saveVault),
            100e18
        );

        Token(address(usdst)).approve(address(router), 100e18);
        uint256 amountOut = router.executeRoute(
            address(usdst),
            address(saveVault),
            100e18,
            address(this),
            steps,
            block.timestamp + 300,
            100e18
        );

        require(amountOut == 100e18, "Unexpected save output");
        require(
            saveVault.balanceOf(address(this)) == 100e18,
            "Save shares not delivered"
        );
        require(
            Token(address(usdst)).balanceOf(address(router)) == 0,
            "Input stranded"
        );
    }

    function it_routes_through_psm_and_forge() {
        RouteStep[] steps = new RouteStep[](2);
        steps[0] = _step(
            RouteAction.PSM_MINT,
            address(psm),
            address(payToken),
            address(usdst),
            100e18
        );
        steps[1] = _step(
            RouteAction.FORGE,
            address(forge),
            address(usdst),
            address(gold),
            1e18
        );

        Token(address(payToken)).approve(address(router), 100e18);
        uint256 amountOut = router.executeRoute(
            address(payToken),
            address(gold),
            100e18,
            address(this),
            steps,
            block.timestamp + 300,
            1e18
        );

        require(amountOut == 1e18, "Unexpected forge output");
        require(
            Token(address(gold)).balanceOf(address(router)) == 0,
            "Output stranded"
        );
    }

    function it_rolls_back_when_final_minimum_is_not_met() {
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.SAVE,
            address(saveVault),
            address(usdst),
            address(saveVault),
            1
        );

        uint256 beforeBalance = Token(address(usdst)).balanceOf(address(this));
        Token(address(usdst)).approve(address(router), 100e18);
        bool reverted = false;
        try router.executeRoute(
            address(usdst),
            address(saveVault),
            100e18,
            address(this),
            steps,
            block.timestamp + 300,
            101e18
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Final slippage should revert");
        require(
            Token(address(usdst)).balanceOf(address(this)) == beforeBalance,
            "Input should roll back"
        );
        require(
            saveVault.balanceOf(address(this)) == 0,
            "Shares should roll back"
        );
    }

    function it_rejects_a_route_step_with_the_wrong_target() {
        RouteStep[] steps = new RouteStep[](1);
        steps[0] = _step(
            RouteAction.PSM_MINT,
            address(forge),
            address(payToken),
            address(usdst),
            1
        );

        uint256 beforeBalance = Token(address(payToken)).balanceOf(address(this));
        Token(address(payToken)).approve(address(router), 100e18);
        bool reverted = false;
        try router.executeRoute(
            address(payToken),
            address(usdst),
            100e18,
            address(this),
            steps,
            block.timestamp + 300,
            1
        ) {
        } catch {
            reverted = true;
        }

        require(reverted, "Invalid target should revert");
        require(
            Token(address(payToken)).balanceOf(address(this)) == beforeBalance,
            "Input should not move"
        );
    }
}

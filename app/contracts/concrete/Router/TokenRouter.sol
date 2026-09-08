import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../libraries/Router/RouterTypes.sol";
import "../Metals/MetalForge.sol";
import "../Pools/DirectMintPSM.sol";
import "../Pools/Pool.sol";
import "../Pools/PoolFactory.sol";
import "../Pools/PoolV3.sol";
import "../Pools/PoolV3Factory.sol";
import "../Pools/StablePool.sol";
import "../Savings/SaveUSDSTVault.sol";
import "../YieldVault/YieldVault.sol";

contract record TokenRouter is Ownable {
    using RouterTypes for *;

    uint256 public constant MAX_STEPS = 6;

    PoolFactory public poolFactory;
    PoolV3Factory public poolV3Factory;
    DirectMintPSM public directMintPsm;
    MetalForge public metalForge;
    SaveUSDSTVault public saveUsdstVault;
    mapping(address => bool) public approvedYieldVaults;

    bool public initialized;
    bool public paused;
    bool private locked;

    event RouteExecuted(
        address caller,
        address recipient,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut
    );
    event RouteStepExecuted(
        uint256 stepIndex,
        uint256 action,
        address target,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event PoolFactoryUpdated(address newPoolFactory);
    event PoolV3FactoryUpdated(address newPoolV3Factory);
    event DirectMintPsmUpdated(address newDirectMintPsm);
    event MetalForgeUpdated(address newMetalForge);
    event SaveUsdstVaultUpdated(address newSaveUsdstVault);
    event YieldVaultApprovalUpdated(address yieldVault, bool approved);
    event PauseUpdated(bool paused);

    modifier nonReentrant() {
        require(!locked, "TR: reentrant");
        locked = true;
        _;
        locked = false;
    }

    modifier whenNotPaused() {
        require(!paused, "TR: paused");
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function initialize(
        address _poolFactory,
        address _poolV3Factory,
        address _directMintPsm,
        address _metalForge,
        address _saveUsdstVault
    ) external onlyOwner {
        require(!initialized, "TR: already initialized");
        _setPoolFactory(_poolFactory);
        _setPoolV3Factory(_poolV3Factory);
        _setDirectMintPsm(_directMintPsm);
        _setMetalForge(_metalForge);
        _setSaveUsdstVault(_saveUsdstVault);
        initialized = true;
    }

    function setPoolFactory(address newPoolFactory) external onlyOwner {
        _setPoolFactory(newPoolFactory);
    }

    function setPoolV3Factory(address newPoolV3Factory) external onlyOwner {
        _setPoolV3Factory(newPoolV3Factory);
    }

    function setDirectMintPsm(address newDirectMintPsm) external onlyOwner {
        _setDirectMintPsm(newDirectMintPsm);
    }

    function setMetalForge(address newMetalForge) external onlyOwner {
        _setMetalForge(newMetalForge);
    }

    function setSaveUsdstVault(address newSaveUsdstVault) external onlyOwner {
        _setSaveUsdstVault(newSaveUsdstVault);
    }

    function setYieldVault(address yieldVault, bool approved) external onlyOwner {
        require(yieldVault != address(0), "TR: zero yield vault");
        if (approved) {
            require(YieldVault(yieldVault).asset() != address(0), "TR: invalid yield vault");
        }
        approvedYieldVaults[yieldVault] = approved;
        emit YieldVaultApprovalUpdated(yieldVault, approved);
    }

    function setPaused(bool isPaused) external onlyOwner {
        paused = isPaused;
        emit PauseUpdated(isPaused);
    }

    function executeRoute(
        address tokenIn,
        address expectedTokenOut,
        uint256 amountIn,
        address recipient,
        RouteStep[] steps,
        uint256 deadline,
        uint256 minFinalOut
    ) external whenNotPaused nonReentrant returns (uint256 amountOut) {
        require(initialized, "TR: not initialized");
        require(tokenIn != address(0), "TR: zero input token");
        require(expectedTokenOut != address(0), "TR: zero output token");
        require(amountIn > 0, "TR: zero input");
        require(recipient != address(0) && recipient != address(this), "TR: invalid recipient");
        require(steps.length > 0 && steps.length <= MAX_STEPS, "TR: invalid route");
        require(block.timestamp <= deadline, "TR: expired");
        require(minFinalOut > 0, "TR: zero final minimum");

        uint256 inputBalanceBefore = IERC20(tokenIn).balanceOf(address(this));
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "TR: input transfer failed");
        uint256 currentAmount = IERC20(tokenIn).balanceOf(address(this)) - inputBalanceBefore;
        require(currentAmount > 0, "TR: no input received");

        address currentToken = tokenIn;
        for (uint256 i = 0; i < steps.length; i++) {
            RouteStep step = steps[i];
            require(step.action != RouteAction.NONE, "TR: invalid action");
            require(step.target != address(0), "TR: zero target");
            require(step.tokenIn == currentToken, "TR: route discontinuity");
            require(step.tokenOut != address(0) && step.tokenOut != step.tokenIn, "TR: invalid output token");
            require(step.minAmountOut > 0, "TR: zero step minimum");

            uint256 stepAmountIn = currentAmount;
            currentAmount = _executeStep(step, stepAmountIn, deadline);
            currentToken = step.tokenOut;

            emit RouteStepExecuted(
                i,
                uint256(step.action),
                step.target,
                step.tokenIn,
                step.tokenOut,
                stepAmountIn,
                currentAmount
            );
        }

        require(currentToken == expectedTokenOut, "TR: unexpected final token");
        require(currentAmount >= minFinalOut, "TR: final slippage");
        uint256 recipientBalanceBefore = IERC20(currentToken).balanceOf(recipient);
        require(IERC20(currentToken).transfer(recipient, currentAmount), "TR: output transfer failed");
        amountOut = IERC20(currentToken).balanceOf(recipient) - recipientBalanceBefore;
        require(amountOut >= minFinalOut, "TR: final transfer slippage");

        emit RouteExecuted(msg.sender, recipient, tokenIn, amountIn, currentToken, amountOut);
    }

    function _executeStep(
        RouteStep step,
        uint256 amountIn,
        uint256 deadline
    ) internal returns (uint256 amountOut) {
        _validateStep(step);

        uint256 inputBalanceBefore = IERC20(step.tokenIn).balanceOf(address(this));
        uint256 outputBalanceBefore = IERC20(step.tokenOut).balanceOf(address(this));
        require(inputBalanceBefore >= amountIn, "TR: insufficient step input");
        require(IERC20(step.tokenIn).approve(step.target, amountIn), "TR: approval failed");

        if (step.action == RouteAction.SWAP_V2) {
            Pool(step.target).swap(step.direction, amountIn, step.minAmountOut, deadline);
        } else if (step.action == RouteAction.SWAP_STABLE) {
            StablePool(step.target).exchange(
                step.parameter1,
                step.parameter2,
                amountIn,
                step.minAmountOut,
                address(this)
            );
        } else if (step.action == RouteAction.SWAP_V3) {
            require(amountIn <= 2 ** 255 - 1, "TR: v3 amount overflow");
            PoolV3(step.target).swap(
                address(this),
                step.direction,
                int(amountIn),
                step.parameter1,
                step.minAmountOut,
                deadline
            );
        } else if (step.action == RouteAction.PSM_MINT) {
            DirectMintPSM(step.target).mint(amountIn, step.tokenIn);
        } else if (step.action == RouteAction.FORGE) {
            MetalForge(step.target).mintMetal(step.tokenOut, step.tokenIn, amountIn, step.minAmountOut);
        } else if (step.action == RouteAction.SAVE) {
            SaveUSDSTVault(step.target).deposit(amountIn, address(this));
        } else if (step.action == RouteAction.YIELD_VAULT_DEPOSIT) {
            YieldVault(step.target).deposit(amountIn, address(this));
        } else {
            revert("TR: invalid action");
        }

        require(IERC20(step.tokenIn).approve(step.target, 0), "TR: approval reset failed");
        uint256 inputBalanceAfter = IERC20(step.tokenIn).balanceOf(address(this));
        require(inputBalanceBefore - inputBalanceAfter == amountIn, "TR: incomplete input");

        amountOut = IERC20(step.tokenOut).balanceOf(address(this)) - outputBalanceBefore;
        require(amountOut > 0, "TR: no step output");
        require(amountOut >= step.minAmountOut, "TR: step slippage");
    }

    function _validateStep(RouteStep step) internal view {
        if (step.action == RouteAction.SWAP_V2) {
            Pool pool = Pool(step.target);
            require(address(pool.poolFactory()) == address(poolFactory), "TR: invalid v2 factory");
            require(poolFactory.pools(step.tokenIn, step.tokenOut) == step.target, "TR: unregistered v2 pool");
            address expectedIn = step.direction ? address(pool.tokenA()) : address(pool.tokenB());
            address expectedOut = step.direction ? address(pool.tokenB()) : address(pool.tokenA());
            require(step.tokenIn == expectedIn && step.tokenOut == expectedOut, "TR: invalid v2 pair");
        } else if (step.action == RouteAction.SWAP_STABLE) {
            StablePool pool = StablePool(step.target);
            require(pool.getPoolFactory() == address(poolFactory), "TR: invalid stable factory");
            if (poolFactory.pools(step.tokenIn, step.tokenOut) != step.target) {
                require(poolFactory.allPools(step.factoryPoolIndex) == step.target, "TR: unregistered stable pool");
            }
            require(step.parameter1 < pool.getNumCoins() && step.parameter2 < pool.getNumCoins(), "TR: invalid coin index");
            require(
                address(pool.coins(step.parameter1)) == step.tokenIn &&
                address(pool.coins(step.parameter2)) == step.tokenOut,
                "TR: invalid stable pair"
            );
        } else if (step.action == RouteAction.SWAP_V3) {
            PoolV3 pool = PoolV3(step.target);
            require(address(pool.poolV3Factory()) == address(poolV3Factory), "TR: invalid v3 factory");
            require(
                poolV3Factory.pools(step.tokenIn, step.tokenOut, pool.fee()) == step.target,
                "TR: unregistered v3 pool"
            );
            address expectedIn = step.direction ? address(pool.token0()) : address(pool.token1());
            address expectedOut = step.direction ? address(pool.token1()) : address(pool.token0());
            require(step.tokenIn == expectedIn && step.tokenOut == expectedOut, "TR: invalid v3 pair");
        } else if (step.action == RouteAction.PSM_MINT) {
            require(step.target == address(directMintPsm), "TR: invalid psm");
            require(step.tokenOut == directMintPsm.mintableToken(), "TR: invalid psm output");
        } else if (step.action == RouteAction.FORGE) {
            require(step.target == address(metalForge), "TR: invalid forge");
        } else if (step.action == RouteAction.SAVE) {
            require(step.target == address(saveUsdstVault), "TR: invalid save vault");
            require(step.tokenIn == saveUsdstVault.asset(), "TR: invalid save asset");
            require(step.tokenOut == address(saveUsdstVault), "TR: invalid save output");
        } else if (step.action == RouteAction.YIELD_VAULT_DEPOSIT) {
            require(approvedYieldVaults[step.target], "TR: unapproved yield vault");
            require(step.tokenIn == YieldVault(step.target).asset(), "TR: invalid yield vault asset");
            require(step.tokenOut == step.target, "TR: invalid yield vault output");
        } else {
            revert("TR: invalid action");
        }
    }

    function _setPoolFactory(address newPoolFactory) internal {
        require(newPoolFactory != address(0), "TR: zero pool factory");
        require(PoolFactory(newPoolFactory).tokenFactory() != address(0), "TR: invalid pool factory");
        poolFactory = PoolFactory(newPoolFactory);
        emit PoolFactoryUpdated(newPoolFactory);
    }

    function _setPoolV3Factory(address newPoolV3Factory) internal {
        require(newPoolV3Factory != address(0), "TR: zero v3 factory");
        require(PoolV3Factory(newPoolV3Factory).tokenFactory() != address(0), "TR: invalid v3 factory");
        poolV3Factory = PoolV3Factory(newPoolV3Factory);
        emit PoolV3FactoryUpdated(newPoolV3Factory);
    }

    function _setDirectMintPsm(address newDirectMintPsm) internal {
        require(newDirectMintPsm != address(0), "TR: zero psm");
        require(DirectMintPSM(newDirectMintPsm).mintableToken() != address(0), "TR: invalid psm");
        directMintPsm = DirectMintPSM(newDirectMintPsm);
        emit DirectMintPsmUpdated(newDirectMintPsm);
    }

    function _setMetalForge(address newMetalForge) internal {
        require(newMetalForge != address(0), "TR: zero forge");
        require(address(MetalForge(newMetalForge).usdst()) != address(0), "TR: invalid forge");
        metalForge = MetalForge(newMetalForge);
        emit MetalForgeUpdated(newMetalForge);
    }

    function _setSaveUsdstVault(address newSaveUsdstVault) internal {
        require(newSaveUsdstVault != address(0), "TR: zero save vault");
        require(SaveUSDSTVault(newSaveUsdstVault).asset() != address(0), "TR: invalid save vault");
        saveUsdstVault = SaveUSDSTVault(newSaveUsdstVault);
        emit SaveUsdstVaultUpdated(newSaveUsdstVault);
    }
}

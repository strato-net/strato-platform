// SPDX-License-Identifier: MIT
import "../Tokens/Token.sol";
import "../Tokens/TokenFactory.sol";
import "../Admin/AdminRegistry.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract record Pool is Ownable {
    
    // Events
    event Swap(address sender, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event AddLiquidity(address provider, uint256 tokenBAmount, uint256 tokenAAmount);
    event RemoveLiquidity(address provider, uint256 tokenBAmount, uint256 tokenAAmount);
    event FeeParametersUpdated(uint256 oldSwapFeeRate, uint256 newSwapFeeRate, uint256 oldLpSharePercent, uint256 newLpSharePercent, uint256 oldProtocolSharePercent, uint256 newProtocolSharePercent);
    event FeeCollectorUpdated(address oldFeeCollector, address newFeeCollector);

    Token public tokenA;
    Token public tokenB;
    Token public lpToken;
    TokenFactory public tokenFactory;
    AdminRegistry public adminRegistry;

    bool private locked;   
    
    decimal public aToBRatio;
    decimal public bToARatio;

    uint public tokenABalance;
    uint public tokenBBalance;

    // All fee variables are in basis points (bps): 1% = 100 bps, 0.3% = 30 bps, 70% = 7000 bps
    uint256 public swapFeeRate = 30; // 30 bps = 0.3%
    uint256 public lpSharePercent = 7000; // 7000 bps = 70%
    uint256 public protocolSharePercent = 3000; // 3000 bps = 30%
    uint256 public feePerShare;
    address public feeCollector;
    mapping(address => uint256) public record rewardDebt;
    
    modifier nonReentrant() {
        require(!locked, "REENTRANT");
        locked = true;
        _;
        locked = false;
    }

    modifier onlyOwnerOrAdmin() {
        require(msg.sender == owner() || adminRegistry.isAdminAddress(msg.sender), "Pool: caller is not owner or admin");
        _;
    }

    constructor(
        address tokenAAddr, 
        address tokenBAddr,
        address _tokenFactory,
        address _feeCollector,
        address _adminRegistry
    ) Ownable(msg.sender) {
        require(_tokenFactory != address(0), "Zero token factory address");
        require(_feeCollector != address(0), "Zero fee collector address");
        require(_adminRegistry != address(0), "Zero admin registry address");
        
        tokenFactory = TokenFactory(_tokenFactory);
        adminRegistry = AdminRegistry(_adminRegistry);
        tokenA = Token(tokenAAddr);
        tokenB = Token(tokenBAddr);
        
        // Create LP token through token factory
        string lpName = ERC20(tokenAAddr).name() + "-" + ERC20(tokenBAddr).name() + " LP Token";
        string lpSymbol = ERC20(tokenAAddr).symbol() + "-" + ERC20(tokenBAddr).symbol() + "-LP";
        
        address lpTokenAddress = tokenFactory.createToken(
            lpName,
            "Liquidity Provider Token",
            [],
            [],
            [],
            lpSymbol,
            0,
            18
        );
        
        lpToken = Token(lpTokenAddress);

        feeCollector = _feeCollector;
    }

    /// @notice Update fee parameters (owner or admin only)
    /// @param newSwapFeeRate New swap fee rate in basis points
    /// @param newLpSharePercent New LP share percentage in basis points
    /// @param newProtocolSharePercent New protocol share percentage in basis points
    function updateFeeParameters(
        uint256 newSwapFeeRate,
        uint256 newLpSharePercent,
        uint256 newProtocolSharePercent
    ) external onlyOwnerOrAdmin {
        require(newSwapFeeRate <= 1000, "Swap fee rate too high"); // Max 10%
        require(newLpSharePercent + newProtocolSharePercent == 10000, "LP and protocol shares must sum to 100%");
        require(newLpSharePercent > 0 && newProtocolSharePercent > 0, "Both shares must be greater than 0");
        
        uint256 oldSwapFeeRate = swapFeeRate;
        uint256 oldLpSharePercent = lpSharePercent;
        uint256 oldProtocolSharePercent = protocolSharePercent;
        
        swapFeeRate = newSwapFeeRate;
        lpSharePercent = newLpSharePercent;
        protocolSharePercent = newProtocolSharePercent;
        
        emit FeeParametersUpdated(
            oldSwapFeeRate, newSwapFeeRate,
            oldLpSharePercent, newLpSharePercent,
            oldProtocolSharePercent, newProtocolSharePercent
        );
    }

    /// @notice Update the fee collector address (owner or admin only)
    /// @param newFeeCollector New fee collector address
    function setFeeCollector(address newFeeCollector) external onlyOwnerOrAdmin {
        require(newFeeCollector != address(0), "Zero fee collector address");
        address oldFeeCollector = feeCollector;
        feeCollector = newFeeCollector;
        emit FeeCollectorUpdated(oldFeeCollector, newFeeCollector);
    }

    /// @notice Update the admin registry address (owner only)
    /// @param newAdminRegistry New admin registry address
    function setAdminRegistry(address newAdminRegistry) external onlyOwner {
        require(newAdminRegistry != address(0), "Zero admin registry address");
        adminRegistry = AdminRegistry(newAdminRegistry);
    }

    function _updateStateVars() internal {
        tokenABalance = ERC20(tokenA).balanceOf(address(this));
        tokenBBalance = ERC20(tokenB).balanceOf(address(this));
        aToBRatio = _getCurrentTokenRatio(true);
        bToARatio = _getCurrentTokenRatio(false);
    }

    function _getCurrentTokenRatio(bool isAToB) internal view returns (decimal) {
        decimal tokenAReserve = decimal(tokenABalance);
        decimal tokenBReserve = decimal(tokenBBalance);

        if (tokenAReserve <= 0.000000000000000000 || tokenBReserve <= 0.000000000000000000) {
            return 0.000000000000000000;
        }

        if (isAToB) {
            return decimal((tokenBReserve * 1.000000000000000000) / tokenAReserve) / 1.000000000000000000;
        } else {
            return decimal((tokenAReserve * 1.000000000000000000) / tokenBReserve) / 1.000000000000000000;
        }
        return 0.000000000000000000;
    }

    // Core functions
    function addLiquidity(
        uint256 tokenBAmount,
        uint256 maxTokenAAmount
    ) external returns (uint256) {
        require(tokenBAmount > 0 && maxTokenAAmount > 0, "Invalid inputs");
        uint256 totalLiquidity = ERC20(lpToken).totalSupply();
        
        if (totalLiquidity > 0) {
            uint256 tokenBReserve = ERC20(tokenB).balanceOf(address(this));
            uint256 tokenAReserve = ERC20(tokenA).balanceOf(address(this));
            uint256 tokenAAmount = (tokenBAmount * tokenAReserve / tokenBReserve) + 1;
            uint256 liquidityMinted = tokenBAmount * totalLiquidity / tokenBReserve;

            require(maxTokenAAmount >= tokenAAmount, "Insufficient tokenA amount");
            lpToken.mint(msg.sender, liquidityMinted);
            rewardDebt[msg.sender] = (ERC20(lpToken).balanceOf(msg.sender) * feePerShare) / 1e18;

            require(ERC20(tokenB).transferFrom(msg.sender, address(this), tokenBAmount), "TokenB transfer failed");
            require(ERC20(tokenA).transferFrom(msg.sender, address(this), tokenAAmount), "TokenA transfer failed");

            emit AddLiquidity(msg.sender, tokenBAmount, tokenAAmount);

            _updateStateVars();

            return liquidityMinted;
        } else {
            uint256 tokenAAmount = maxTokenAAmount;
            uint256 initialLiquidity = tokenBAmount;
            lpToken.mint(msg.sender, initialLiquidity);
            rewardDebt[msg.sender] = (ERC20(lpToken).balanceOf(msg.sender) * feePerShare) / 1e18;

            require(ERC20(tokenB).transferFrom(msg.sender, address(this), tokenBAmount), "TokenB transfer failed");
            require(ERC20(tokenA).transferFrom(msg.sender, address(this), tokenAAmount), "TokenA transfer failed");

            emit AddLiquidity(msg.sender, tokenBAmount, tokenAAmount);

            _updateStateVars();

            return initialLiquidity;
        }
    }

    function removeLiquidity(
        uint256 lpTokenAmount, 
        uint256 minTokenBAmount,
        uint256 minTokenAAmount
    ) external returns (uint256, uint256) {
        require(lpTokenAmount > 0 && minTokenBAmount > 0 && minTokenAAmount > 0, "Invalid inputs");
        uint256 totalLiquidity = ERC20(lpToken).totalSupply();
        require(totalLiquidity > 0, "No liquidity");
        uint256 tokenAReserve = ERC20(tokenA).balanceOf(address(this));
        uint256 tokenBReserve = ERC20(tokenB).balanceOf(address(this));
        uint256 tokenBAmount = lpTokenAmount * tokenBReserve / totalLiquidity;
        uint256 tokenAAmount = lpTokenAmount * tokenAReserve / totalLiquidity;
        
        require(tokenBAmount >= minTokenBAmount && tokenAAmount >= minTokenAAmount, "Insufficient amounts");

        require(ERC20(tokenB).transfer(msg.sender, tokenBAmount), "TokenB transfer failed");
        require(ERC20(tokenA).transfer(msg.sender, tokenAAmount), "TokenA transfer failed");

        emit RemoveLiquidity(msg.sender, tokenBAmount, tokenAAmount);

        lpToken.burn(msg.sender, lpTokenAmount);
        rewardDebt[msg.sender] = (ERC20(lpToken).balanceOf(msg.sender) * feePerShare) / 1e18;

        _updateStateVars();

        return (tokenBAmount, tokenAAmount);
    }

    // Private pricing functions
    function getInputPrice(
        uint256 inputAmount,
        uint256 inputReserve,
        uint256 outputReserve
    ) pure returns (uint256) {
        require(inputReserve > 0 && outputReserve > 0, "Invalid reserves");
        uint256 numerator = inputAmount * outputReserve;
        uint256 denominator = inputReserve + inputAmount;
        return numerator / denominator;
    }

    function swap(
        bool isAToB,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0 && minAmountOut > 0, "Invalid input");

        Token inputToken = isAToB ? tokenA : tokenB;
        Token outputToken = isAToB ? tokenB : tokenA;

        uint256 inputReserve = ERC20(inputToken).balanceOf(address(this));
        uint256 outputReserve = ERC20(outputToken).balanceOf(address(this));

        uint256 fee = (amountIn * swapFeeRate) / 10000;
        uint256 lpFee = (fee * lpSharePercent) / 10000;
        uint256 protocolFee = fee - lpFee;

        uint256 netInput = amountIn - fee;
        uint256 totalSupply = ERC20(lpToken).totalSupply();

        if (totalSupply > 0) {
            feePerShare += (lpFee * 1e18) / totalSupply;
        }

        // Transfer total amount (including protocol fee) to pool
        require(ERC20(inputToken).transferFrom(msg.sender, address(this), amountIn), "Total input transfer failed");
        
        // Send protocol fee to fee collector
        require(ERC20(inputToken).approve(feeCollector, protocolFee), "Protocol fee approve failed");
        FeeCollector(feeCollector).receiveFee(address(inputToken), protocolFee);

        amountOut = getInputPrice(netInput, inputReserve, outputReserve);
        require(amountOut >= minAmountOut, "Slippage check failed");

        require(ERC20(outputToken).transfer(msg.sender, amountOut), "Output xfer failed");

        _updateStateVars();

        emit Swap(msg.sender, address(inputToken), address(outputToken), amountIn, amountOut);
    }

    function claimFees() external {
        uint256 accrued = (ERC20(lpToken).balanceOf(msg.sender) * feePerShare) / 1e18;
        uint256 pending = accrued - rewardDebt[msg.sender];
        rewardDebt[msg.sender] = accrued;

        require(ERC20(tokenA).transfer(msg.sender, pending), "Claim transfer failed");
    }
}

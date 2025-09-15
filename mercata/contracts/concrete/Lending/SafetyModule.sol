import "./LendingRegistry.sol";
import "./LendingPool.sol";
import "./PoolConfigurator.sol";
import "../Tokens/Token.sol";

import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

/**
 * @title SafetyModule
 * @notice Handles the safety module for the lending pool.
 * @dev Only callable by the LendingPool.
 */

contract record SafetyModule is Ownable {
    LendingRegistry public registry;
    PoolConfigurator public poolConfigurator;
    address public sToken;
    address public underlyingAsset;

    event Slashed(uint amount, uint remaining);
    event ExchangeRateUpdated(uint newRate);
    event Deposited(address indexed user, uint amount, uint sTokenAmount);
    event Withdrawn(address indexed user, uint amount, uint sTokenAmount);

    constructor(address _registry, address _poolConfigurator, address initialOwner, address _sToken, address _underlyingAsset) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry address");
        require(_poolConfigurator != address(0), "Invalid pool configurator address");
        registry = LendingRegistry(_registry);
        poolConfigurator = PoolConfigurator(_poolConfigurator);
        sToken = _sToken;
        underlyingAsset = _underlyingAsset;
    }

    modifier isConfigured() {
        require(sToken != address(0), "sToken not set");
        require(underlyingAsset != address(0), "underlyingAsset not set");
        //TODO ensure tokens active in token factory, if necessary
        _;
    }

    // Setter function for updating the LendingRegistry reference
    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
    }

    function _lendingPool() internal view returns (LendingPool) {
        return LendingPool(registry.lendingPool());
    }

    modifier onlyLendingPool() {
        require(msg.sender == address(registry.lendingPool()), "Caller is not LendingPool");
        _;
    }

    /**
     * @notice Deposit underlying asset into the safety module, in exchange for sTokens
     * @param amount The amount of underlying asset to deposit
     */
    function deposit(uint amount) external isConfigured {
        require(amount > 0, "Invalid amount");
        require(sToken != address(0), "sToken not set");

        uint sTokenAmount = (amount * 1e18) / getExchangeRate();

        require(IERC20(underlyingAsset).transferFrom(msg.sender, address(this), amount), "Deposit failed");
        Token(sToken).mint(msg.sender, sTokenAmount);

        emit Deposited(msg.sender, amount, sTokenAmount);
        emit ExchangeRateUpdated(getExchangeRate());
    }

    /**
     * @notice Withdraw underlying asset from the safety module, trading in sTokens
     * @param amount The amount of underlying asset to withdraw
     */
    function withdraw(uint amount) external isConfigured {
        require(amount > 0, "Invalid amount");
        require(sToken != address(0), "sToken not set");

        // Calculate mTokens to burn based on current exchange rate
        uint exchangeRate = getExchangeRate();
        // ceilDiv: (a + b - 1) / b
        uint sTokenAmount = (amount * 1e18 + exchangeRate - 1) / exchangeRate;

        // Burn sTokens in exchange for underlying assets
        Token(sToken).burn(msg.sender, sTokenAmount);
        require(IERC20(underlyingAsset).transfer(msg.sender, amount), "Withdraw failed");

        emit Withdrawn(msg.sender, amount, sTokenAmount);
        emit ExchangeRateUpdated(getExchangeRate());
    }

    /**
     * @notice Trade in all sTokens, withdrawing underling assets from the safety module
     */
    function withdrawAll() external isConfigured {
        uint sTokenBalance = IERC20(sToken).balanceOf(msg.sender);
        require(sTokenBalance > 0, "No sTokens to withdraw");

        uint underlyingAmount = (sTokenBalance * getExchangeRate()) / 1e18;
        
        // Burn sTokens in exchange for underlying assets
        Token(sToken).burn(msg.sender, sTokenBalance);
        require(IERC20(underlyingAsset).transfer(msg.sender, underlyingAmount), "Withdraw failed");

        emit Withdrawn(msg.sender, underlyingAmount, sTokenBalance);
        emit ExchangeRateUpdated(getExchangeRate());
    }

    /**
     * @notice Get the exchange rate of the sToken in terms of the underlying asset
     * @return The exchange rate in 1e18 scale (1e18 implies 1 underlying per sToken)
     */
    function getExchangeRate() public view isConfigured returns (uint) {
        uint assetBalance = IERC20(underlyingAsset).balanceOf(address(this));
        uint sTokenSupply = IERC20(sToken).totalSupply();

        // Fallback to 1:1 if no sTokens in circulation
        if (sTokenSupply == 0) return 1e18;

        uint exchangeRate = (assetBalance * 1e18) / sTokenSupply;

        // Fallback to 1:1 if no or too few assets
        if (exchangeRate == 0) return 1e18;

        return exchangeRate;
    }

    /**
     * @notice Slash the safety module,
     *         transferring the underlying asset to the LendingPool to cover the bad debt.
     * @param amount The amount of underlying asset to slash
     * @return covered The amount of underlying asset successfully covered
     */
    function slash(uint amount) external onlyLendingPool isConfigured returns (uint covered) {
        require(amount > 0, "Invalid amount");
        uint assetBalance = IERC20(underlyingAsset).balanceOf(address(this));
        uint slashAmount = assetBalance < amount ? assetBalance : amount;

        // Tranfer assets to LendingPool
        require(IERC20(underlyingAsset).transfer(address(_lendingPool()), slashAmount), "Slash transfer failed");

        // assetBalance - slashAmount
        uint remaining = IERC20(underlyingAsset).balanceOf(address(this));

        emit Slashed(slashAmount, remaining);
        emit ExchangeRateUpdated(getExchangeRate());
        
        return slashAmount;
    }
}
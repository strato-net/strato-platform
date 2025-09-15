import "./LendingRegistry.sol";
import "./LendingPool.sol";
import "./PoolConfigurator.sol";

import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

/**
 * @title SafetyModule
 * @notice Handles the safety module for the lending pool.
 * @dev Only callable by the LendingPool.
 */

contract record SafetyModule is Ownable {
    LendingRegistry public registry;
    address public sToken; //TODO ensure token active like in lending pool
    address public underlyingAsset;
    address public poolConfigurator;

    event Slashed(uint amount, uint remaining);
    event ExchangeRateUpdated(uint newRate);

    constructor(address _registry, address _poolConfigurator, address initialOwner, address _sToken, address _underlyingAsset) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry address");
        require(_poolConfigurator != address(0), "Invalid pool configurator address");
        registry = LendingRegistry(_registry);
        poolConfigurator = PoolConfigurator(_poolConfigurator);
        sToken = _sToken;
        underlyingAsset = _underlyingAsset;
    }

    // Setter function for updating the LendingRegistry reference
    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
    }

    function _lendingPool() internal view returns (LendingPool) {
        return LendingPool(registry.lendingPool());
    }

    /**
     * @notice Get the exchange rate of the sToken in terms of the underlying asset
     * @return The exchange rate in 1e18 scale (1e18 implies 1 underlying per sToken)
     */
    function getExchangeRate() public view returns (uint) {
        uint assetBalance = IERC20(underlyingAsset).balanceOf(address(this));
        uint sTokenSupply = IERC20(sToken).totalSupply();
        return (assetBalance * 1e18) / sTokenSupply;
    }

    /**
     * @notice Slash the safety module,
     *         transferring the underlying asset to the LendingPool to cover the bad debt.
     * @param amount The amount of underlying asset to slash
     * @return covered The amount of underlying asset successfully covered
     */
    function slash(uint amount) external onlyLendingPool returns (uint covered) {
        require(amount > 0, "Invalid amount");
        uint assetBalance = IERC20(underlyingAsset).balanceOf(address(this));
        uint slashAmount = assetBalance < amount ? assetBalance : amount;
        IERC20(underlyingAsset).transfer(_lendingPool(), slashAmount);

        // assetBalance - slashAmount
        uint remaining = IERC20(underlyingAsset).balanceOf(address(this));

        emit Slashed(slashAmount, remaining);
        emit ExchangeRateUpdated(getExchangeRate());
        
        return slashAmount;
    }
}
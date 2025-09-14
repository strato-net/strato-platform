import "./LendingRegistry.sol";
import "./LendingPool.sol";

import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

/**
 * @title SafetyModule
 * @notice Handles the safety module for the lending pool.
 * @dev Only callable by the LendingPool.
 */

contract record SafetyModule is Ownable {
    LendingRegistry public registry;
    address public sToken;
    address public underlyingAsset;

    event Slashed(uint amount, uint remaining);
    event ExchangeRateUpdated(uint newRate);

    constructor(address _registry, address initialOwner, address _sToken, address _underlyingAsset) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry address");
        require(_sToken != address(0) && tokenFactory.isTokenActive(_sToken), "Invalid or inactive sToken");
        registry = LendingRegistry(_registry);
        sToken = _sToken;
        underlyingAsset = _underlyingAsset;
    }

    // Setter function for updating the LendingRegistry reference
    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
    }

    /**
     * @notice Set sToken for the single borrowable asset
     * @param _sToken The sToken for the asset that can be borrowed
     */
    function setSToken(address _sToken) external onlyPoolConfigurator {
        require(_sToken != address(0) && tokenFactory.isTokenActive(_sToken), "Invalid or inactive sToken");
        sToken = _sToken;
    }

    function _lendingPool() internal view returns (LendingPool) {
        return LendingPool(registry.lendingPool());
    }

    function getExchangeRate() public view returns (uint) {
        //TODO
        return IERC20(underlyingAsset).balanceOf(address(this)) / IERC20(sToken).balanceOf(address(this));
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

        emit Slashed(slashAmount, assetBalance - slashAmount);
        emit ExchangeRateUpdated(getExchangeRate());
        return slashAmount;
    }
}
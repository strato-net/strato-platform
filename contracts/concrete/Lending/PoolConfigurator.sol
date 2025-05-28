import "./LendingRegistry.sol";
import "./LendingPool.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @title PoolConfigurator
 * @notice Governance contract responsible for updating addresses in the LendingRegistry
 *         and configuring LendingPool risk parameters like interest rates and collateral ratios.
 * @dev Meant to be controlled by a multisig, DAO, or timelock for secure protocol configuration.
 */

contract record PoolConfigurator is Ownable {
   
    LendingRegistry public registry;

    constructor(address _registry, address initialOwner) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry");
        registry = LendingRegistry(_registry);
    }

    // Registry Setters
    function setLendingPool(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        registry.setLendingPool(newAddress);
    }

    function setLiquidityPool(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        registry.setLiquidityPool(newAddress);
    }

    function setCollateralVault(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        registry.setCollateralVault(newAddress);
    }

    function setRateStrategy(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        registry.setRateStrategy(newAddress);
    }

    function setPriceOracle(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        registry.setPriceOracle(newAddress);
    }

    // LendingPool Risk Parameters
    function setInterestRate(address asset, uint256 newRate) external onlyOwner {
        LendingPool(registry.lendingPool()).setInterestRate(asset, newRate);
    }

    function setCollateralRatio(address asset, uint256 newRatio) external onlyOwner {
        LendingPool(registry.lendingPool()).setCollateralRatio(asset, newRatio);
    }

    function setLiquidationBonus(address asset, uint256 newBonus) external onlyOwner {
        LendingPool(registry.lendingPool()).setLiquidationBonus(asset, newBonus);
    }
}
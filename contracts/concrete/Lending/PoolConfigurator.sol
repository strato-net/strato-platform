import "./LendingRegistry.sol";
import "./LendingPool.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract record PoolConfigurator is Ownable, LendingRegistry {
   
    constructor(address initialOwner) Ownable(initialOwner) {}

    // Registry Setters
    function updateLendingPool(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        setLendingPool(newAddress);
    }

    function updateLiquidityPool(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        setLiquidityPool(newAddress);
    }

    function updateCollateralVault(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        setCollateralVault(newAddress);
    }

    function updateRateStrategy(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        setRateStrategy(newAddress);
    }

    function updatePriceOracle(address newAddress) external onlyOwner {
        require(newAddress != address(0), "Invalid address");
        setPriceOracle(newAddress);
    }

    // LendingPool Risk Parameters
    function setInterestRate(address asset, uint256 newRate) external onlyOwner {
        LendingPool(lendingPool).setInterestRate(asset, newRate);
    }

    function setCollateralRatio(address asset, uint256 newRatio) external onlyOwner {
        LendingPool(lendingPool).setCollateralRatio(asset, newRatio);
    }

    function setLiquidationBonus(address asset, uint256 newBonus) external onlyOwner {
        LendingPool(lendingPool).setLiquidationBonus(asset, newBonus);
    }
}
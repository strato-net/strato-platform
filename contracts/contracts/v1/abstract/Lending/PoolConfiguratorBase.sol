
pragma solidvm 12.0;
import "./LendingPoolBase.sol";

abstract contract PoolConfiguratorBase {
   
    event LendingPoolUpdated(address indexed newAddress);
    event InterestRateUpdated(address indexed asset, uint256 newRate);
    event CollateralRatioUpdated(address indexed asset, uint256 newRatio);
    event LiquidationBonusUpdated(address indexed asset,uint256 newBonus);

    LendingPoolBase public lendingPool;

    constructor(address _lendingPool) {
        require(_lendingPool != address(0), "Invalid LendingPool address");
        lendingPool = LendingPoolBase(_lendingPool);
    }

    function updateLendingPool(address newAddress) public  {
        lendingPool = LendingPoolBase(newAddress);
        emit LendingPoolUpdated(newAddress);
    }

    function setInterestRate(address asset, uint256 newRate) public  {
        lendingPool.setInterestRate(asset, newRate);
        emit InterestRateUpdated(asset, newRate);
    }

    function setCollateralRatio(address asset, uint256 newRatio) public  {
        lendingPool.setCollateralRatio(asset, newRatio);
        emit CollateralRatioUpdated(asset, newRatio);
    }

    function setLiquidationBonus(address asset, uint256 newBonus) public  {
        lendingPool.setLiquidationBonus(asset, newBonus);
        emit LiquidationBonusUpdated(asset,newBonus);
    }
}
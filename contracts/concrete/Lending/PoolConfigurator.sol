import "./LendingPool.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract record PoolConfigurator is Ownable{
   
    event LendingPoolUpdated(address indexed newAddress);
    event InterestRateUpdated(address indexed asset, uint256 newRate);
    event CollateralRatioUpdated(address indexed asset, uint256 newRatio);
    event LiquidationBonusUpdated(address indexed asset,uint256 newBonus);

    LendingPool public lendingPool;

    constructor (address _lendingPool) {
        require(_lendingPool != address(0), "Invalid LendingPool address");
        lendingPool = LendingPool(_lendingPool);
    }

    function updateLendingPool(address newAddress) public  onlyOwner{
        lendingPool = LendingPool(newAddress);
        emit LendingPoolUpdated(newAddress);
    }

    function setInterestRate(address asset, uint256 newRate) public onlyOwner {
        lendingPool.setInterestRate(asset, newRate);
        emit InterestRateUpdated(asset, newRate);
    }

    function setCollateralRatio(address asset, uint256 newRatio) public onlyOwner {
        lendingPool.setCollateralRatio(asset, newRatio);
        emit CollateralRatioUpdated(asset, newRatio);
    }

    function setLiquidationBonus(address asset, uint256 newBonus) public onlyOwner {
        lendingPool.setLiquidationBonus(asset, newBonus);
        emit LiquidationBonusUpdated(asset,newBonus);
    }
}
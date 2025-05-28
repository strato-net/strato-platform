import "./LendingRegistry.sol";
import "./PoolConfigurator.sol";
import "./CollateralVault.sol";
import "./RateStrategy.sol";
import "./LiquidityPool.sol";
import "./PriceOracle.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @title LendingPool
 * @notice Core lending logic contract managing deposits, borrows, repayments, and liquidations.
 * @dev Risk parameters are configured by PoolConfigurator; operational functions may be owner-gated.
 */

contract record LendingPool is Ownable {
 
    event Deposited(address indexed user, address indexed asset, uint256 amount);
    event Withdrawn(address indexed user, address indexed asset, uint256 amount);
    event Borrowed(address indexed user, address indexed asset, uint256 amount, address indexed collateralAsset, uint256 collateralAmount);
    event Repaid(address indexed user, address indexed asset, uint256 amount);
    event Liquidated(address indexed borrower, address indexed asset, uint256 repaidAmount, address indexed collateralAsset, uint256 collateralSeized);
    event InterestRateSet(address indexed asset, uint256 newRate);
    event CollateralRatioSet(address indexed asset, uint256 newRatio);
    event LiquidationBonusSet(address indexed asset, uint256 newBonus);

    struct LoanInfo {
        address user;
        address asset;
        uint256 amount;
        uint256 lastUpdated;
        address collateralAsset;
        uint256 collateralAmount;
      }

    mapping(string => LoanInfo) public record loans;
    mapping(address => uint256) public record assetInterestRate;
    mapping(address => uint256) public record assetCollateralRatio;
    mapping(address => uint256) public record assetLiquidationBonus;

    LendingRegistry public registry;
    address public poolConfigurator;

    constructor(address _registry, address _poolConfigurator, address initialOwner) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
        require(_poolConfigurator != address(0), "Invalid pool configurator address");
        poolConfigurator = _poolConfigurator;

        assetCollateralRatio[address(0)] = 150;
        assetLiquidationBonus[address(0)] = 105;
        assetInterestRate[address(0)] = 5;
    }

    modifier onlyPoolConfigurator() {
        require(msg.sender == poolConfigurator, "Caller is not PoolConfigurator");
        _;
    }
    
    function _loanKey(address user, address asset)  returns (string) {
        return keccak256(string(user), string(asset), string(block.timestamp));
    }

    function depositLiquidity(address asset, uint256 amount) {
        registry.liquidityPool().deposit(asset, amount, msg.sender);
        emit Deposited(msg.sender, asset, amount);
    }

    function withdrawLiquidity(address asset, uint256 amount) {
        registry.liquidityPool().withdraw(asset, amount, msg.sender);
        emit Withdrawn(msg.sender, asset, amount);
    }

    function getLoan(address asset, uint256 amount, address collateralAsset, uint256 collateralAmount) public {
        string loanId = _loanKey(msg.sender, asset);
        uint256 assetPrice = PriceOracle(registry.priceOracle()).getAssetPrice(asset);
        require(assetPrice > 0, "Asset price not set");
        uint256 collateralPrice = PriceOracle(registry.priceOracle()).getAssetPrice(collateralAsset);
        require(collateralPrice > 0, "Collateral price not set");

        uint256 loanValue = (amount * assetPrice) / 1e18;
        uint256 collateralValue = (collateralAmount * collateralPrice) / 1e18;

        uint256 ratio = assetCollateralRatio[collateralAsset];
        require(ratio > 0, "Collateral ratio not set");
        require(collateralValue * 100 >= loanValue * ratio, "Undercollateralized");

        registry.collateralVault().addCollateral(msg.sender, collateralAsset, collateralAmount);
        registry.liquidityPool().borrow(asset, amount, msg.sender);

        loans[loanId] = LoanInfo(
            msg.sender,
            asset,
            amount,
            block.timestamp,
            collateralAsset,
            collateralAmount
        );

        emit Borrowed(msg.sender, asset, amount, collateralAsset, collateralAmount);
    }

    function repayLoan(string loanId, uint256 amount) public {
        LoanInfo loan = loans[loanId];
        require(loan.amount > 0, "Loan inactive");
        require(amount > 0, "Invalid repayment");

        uint256 interest = registry.rateStrategy().calculateInterest(
            loan.amount,
            assetInterestRate[loan.asset],
            loan.lastUpdated
        );
        uint256 totalOwed = loan.amount + interest;
     
        registry.liquidityPool().repay(loan.asset, amount, totalOwed, msg.sender);

        if (amount >= totalOwed) {
            registry.collateralVault().removeCollateral(msg.sender, loan.collateralAsset, loan.collateralAmount);
            loan.amount = 0;
        } else {
            loan.amount = totalOwed - amount;
            loan.lastUpdated = block.timestamp;
        }

        emit Repaid(msg.sender, loan.asset, amount);
    }

    function liquidate(string loanId, address borrower) public onlyOwner {
        LoanInfo loan = loans[loanId];
        require(loan.amount > 0, "Loan inactive");

        uint256 interest = registry.rateStrategy().calculateInterest(
            loan.amount,
            assetInterestRate[loan.collateralAsset],
            loan.lastUpdated
        );
        uint256 totalOwed = loan.amount + interest;

        uint256 assetPrice = registry.priceOracle().getAssetPrice(loan.collateralAsset);
        uint256 collateralPrice = registry.priceOracle().getAssetPrice(loan.collateralAsset);

        uint256 loanValue = (totalOwed * assetPrice) / 1e18;
        uint256 userCollateral = registry.collateralVault().getCollateral(borrower, loan.collateralAsset);
        uint256 collateralValue = (userCollateral * collateralPrice) / 1e18;

        uint256 ratio = assetCollateralRatio[loan.collateralAsset];
        require(ratio > 0 && collateralValue * 100 < loanValue * ratio, "Healthy loan");

        registry.liquidityPool().repay(loan.collateralAsset, totalOwed, totalOwed, msg.sender);
        uint256 bonus = assetLiquidationBonus[loan.collateralAsset];
        uint256 seizeAmount = (totalOwed * bonus * 1e18) / (collateralPrice * 100);

        require(userCollateral >= seizeAmount, "Insufficient collateral");
        registry.collateralVault().removeCollateral(borrower, loan.collateralAsset, seizeAmount);

        loan.amount = 0;
        emit Liquidated(borrower, loan.collateralAsset, totalOwed, loan.collateralAsset, seizeAmount);
    }

     function setInterestRate(address asset, uint256 newRate) onlyPoolConfigurator{
        require(newRate <= 100, "Rate too high");
        assetInterestRate[asset] = newRate;
    }

    function setCollateralRatio(address asset, uint256 newRatio) onlyPoolConfigurator {
        require(newRatio >= 100, "Ratio too low");
        assetCollateralRatio[asset] = newRatio;
    }

    function setLiquidationBonus(address asset, uint256 newBonus)  onlyPoolConfigurator{
        require(newBonus >= 100, "Bonus too low");
        assetLiquidationBonus[asset] = newBonus;
    }

    function getAvailableLiquidity(address asset)  view  returns (uint256) {
        return registry.liquidityPool().getUserBalance(msg.sender, asset);
    }
}
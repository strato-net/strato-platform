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
        bool active;
        address collateralAsset;
        uint256 collateralAmount;
    }

    uint256 public nextLoanId = 1;
    mapping(uint256 => LoanInfo) public loans;
    mapping(address => uint256[]) public userLoans; // For easy lookup
    mapping(address => uint256) public record assetInterestRate;
    mapping(address => uint256) public record assetCollateralRatio;
    mapping(address => uint256) public record assetLiquidationBonus;

    LendingRegistry public registry;
    TokenFactory public tokenFactory;
    address public poolConfigurator;

    constructor(address _registry, address _poolConfigurator, address initialOwner, address _tokenFactory) Ownable(initialOwner) {
        require(_registry != address(0), "Invalid registry address");
        registry = LendingRegistry(_registry);
        require(_poolConfigurator != address(0), "Invalid pool configurator address");
        poolConfigurator = _poolConfigurator;
        tokenFactory = TokenFactory(_tokenFactory);
    }

    modifier onlyPoolConfigurator() {
        require(msg.sender == poolConfigurator, "Caller is not PoolConfigurator");
        _;
    }

    modifier onlyTokenFactory(address token) {
        require(tokenFactory.isTokenActive(token), "Token not active");
        _;
    }
    
    function _liquidityPool() internal view returns (LiquidityPool) {
        return registry.liquidityPool();
    }

    function _collateralVault() internal view returns (CollateralVault) {
        return registry.collateralVault();
    }

    function _rateStrategy() internal view returns (RateStrategy) {
        return registry.rateStrategy();
    }

    function _priceOracle() internal view returns (PriceOracle) {
        return registry.priceOracle();
    }

    function _loanKey(address user, address asset)  returns (string) {
        return keccak256(string(user), string(asset), string(block.timestamp));
    }

    function depositLiquidity(address asset, uint256 amount) onlyTokenFactory(asset) {
        LiquidityPool(_liquidityPool()).deposit(asset, amount, msg.sender);
        emit Deposited(msg.sender, asset, amount);
    }

    function withdrawLiquidity(address asset, uint256 amount) {
        LiquidityPool(_liquidityPool()).withdraw(asset, amount, msg.sender);
        emit Withdrawn(msg.sender, asset, amount);
    }

    function borrow(address asset, uint256 amount, address collateralAsset, uint256 collateralAmount) public onlyTokenFactory(asset) onlyTokenFactory(collateralAsset) returns (uint256 loanId) {
        uint256 assetPrice = PriceOracle(_priceOracle()).getAssetPrice(asset);
        require(assetPrice > 0, "Asset price not set");
        uint256 collateralPrice = PriceOracle(_priceOracle()).getAssetPrice(collateralAsset);
        require(collateralPrice > 0, "Collateral price not set");

        uint256 loanValue = (amount * assetPrice) / 1e18;
        uint256 collateralValue = (collateralAmount * collateralPrice) / 1e18;

        uint256 ratio = assetCollateralRatio[collateralAsset];
        require(ratio > 0, "Collateral ratio not set");
        require(collateralValue * 100 >= loanValue * ratio, "Undercollateralized");

        CollateralVault(_collateralVault()).addCollateral(msg.sender, collateralAsset, collateralAmount);
        LiquidityPool(_liquidityPool()).borrow(asset, amount, msg.sender);

        loanId = nextLoanId++;
        loans[loanId] = LoanInfo(
            msg.sender,
            asset,
            amount,
            block.timestamp,
            true,
            collateralAsset,
            collateralAmount
        );
        userLoans[msg.sender].push(loanId);

        emit Borrowed(msg.sender, asset, amount, collateralAsset, collateralAmount);
    }

    function repayLoan(uint256 loanId, uint256 amount) public {
        LoanInfo storage loan = loans[loanId];
        require(loan.active, "Loan inactive");
        require(amount > 0, "Invalid repayment");

        uint256 interest = RateStrategy(_rateStrategy()).calculateInterest(
            loan.amount,
            assetInterestRate[loan.asset],
            loan.lastUpdated
        );
        uint256 totalOwed = loan.amount + interest;
    
        LiquidityPool(_liquidityPool()).repay(loan.asset, amount, totalOwed, msg.sender);

        if (amount >= totalOwed) {
            CollateralVault(_collateralVault()).removeCollateral(msg.sender, loan.collateralAsset, loan.collateralAmount);
            loan.amount = 0;
            loan.active = false;
        } else {
            loan.amount = totalOwed - amount;
            loan.active = true;
        }
        loan.lastUpdated = block.timestamp;

        emit Repaid(msg.sender, loan.asset, amount);
    }

    // Permissionless liquidation (no onlyOwner)
    function liquidate(uint256 loanId) external {
        LoanInfo storage loan = loans[loanId];
        require(loan.active, "Loan inactive");
        require(msg.sender != loan.user, "Cannot liquidate own loan");

        uint256 interest = RateStrategy(_rateStrategy()).calculateInterest(
            loan.amount,
            assetInterestRate[loan.asset],
            loan.lastUpdated
        );
        uint256 totalOwed = loan.amount + interest;

        uint256 loanAssetPrice = PriceOracle(_priceOracle()).getAssetPrice(loan.asset);
        uint256 collateralPrice = PriceOracle(_priceOracle()).getAssetPrice(loan.collateralAsset);

        uint256 loanValue = (totalOwed * loanAssetPrice) / 1e18;
        uint256 userCollateral = CollateralVault(_collateralVault()).getCollateral(loan.user, loan.collateralAsset);
        uint256 collateralValue = (userCollateral * collateralPrice) / 1e18;

        uint256 ratio = assetCollateralRatio[loan.collateralAsset];
        require(ratio > 0 && collateralValue * 100 < loanValue * ratio, "Healthy loan");

        // Aave/Morpho formula: up to 50% of debt can be repaid in one liquidation
        uint256 closeFactor = 50; // 50%
        uint256 repayAmount = totalOwed * closeFactor / 100;
        if (repayAmount > totalOwed) {
            repayAmount = totalOwed;
        }
        uint256 liquidationBonus = assetLiquidationBonus[loan.collateralAsset];
        if (liquidationBonus == 0) liquidationBonus = 105; // 5% bonus
        uint256 seizeAmount = (repayAmount * liquidationBonus * loanAssetPrice) / (collateralPrice * 100);

        require(userCollateral >= seizeAmount, "Insufficient collateral");
        LiquidityPool(_liquidityPool()).repay(loan.asset, repayAmount, totalOwed, msg.sender);
        CollateralVault(_collateralVault()).removeCollateral(loan.user, loan.collateralAsset, seizeAmount);

        loan.amount = totalOwed - repayAmount;
        if (loan.amount == 0) {
            loan.active = false;
        }
        loan.lastUpdated = block.timestamp;

        emit Liquidated(loan.user, loan.asset, repayAmount, loan.collateralAsset, seizeAmount);
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

    function setTokenFactory(address _tokenFactory) onlyPoolConfigurator {
        tokenFactory = TokenFactory(_tokenFactory);
    }

    function getAvailableLiquidity(address asset)  view  returns (uint256) {
        return LiquidityPool(_liquidityPool()).getUserBalance(msg.sender, asset);
    }
}
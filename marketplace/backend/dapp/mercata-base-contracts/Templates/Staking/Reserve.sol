pragma es6;
pragma strict;

import <509>;

import "../Assets/Asset.sol";
import "../Escrows/Escrow.sol";
import "../Escrows/SimpleEscrow.sol";
import "../Oracles/OracleService.sol";
import "../Structs/Structs.sol";
import "../Utils/Utils.sol";

abstract contract Reserve is Utils, Structs {
    OracleService public oracle; // Asset Oracle service for fetching price data
    Asset public usdstToken;
    Asset public cataToken;

    decimal public priceOfCATA = 0.10; //cata price in dollars

    address public owner; // Owner (BlockApps) as source of USDST tokens
    string public name;
    bool public isActive = true;
    address public assetRootAddress;

    uint public loanToValueRatio = 50; // LTV ratio as percentage
    uint public liquidationRatio = 30; // Liquidation ratio as percentage
    uint public cataAPYRate = 10; // 10% APY for CATA rewards
    decimal public unitConversionRate = 1; // 1 oz of gold in grams

    decimal public lastUpdatedOraclePrice = 0;
    
    event StakeCreated(address indexed user, address escrow, uint assetAmount, decimal usdstLoan);
    event StakeUnlocked(address indexed user, address escrow, uint quantity);
    event CataTransferred(address indexed from, address indexed to, uint amount);
    event LoanRepaid(address indexed user, address escrow, uint assetAmount, decimal repayment);

    constructor(address _assetOracle, string _name, address _assetRootAddress, decimal _unitConversionRate) {
        oracle = OracleService(_assetOracle);
        owner = msg.sender;
        name = _name;
        assetRootAddress = _assetRootAddress;
        unitConversionRate = _unitConversionRate;
    }

    modifier requireActive() {
        require(isActive, "Reserve is not active");
        _;
    }

    modifier requireOwner(string action) {
        require(msg.sender == owner, "Only owner can " + action + ".");
        _;
    }

    function distributeRewards(address[] _escrowAddresses) external {
        // Update the price of the collateral in the escrow
        (decimal oraclePrice, uint oracleTimestamp) = oracle.getLatestPrice();
        oraclePrice = oraclePrice / unitConversionRate;
        for (uint i = 0; i < _escrowAddresses.length; i++) {
            Escrow escrow = Escrow(_escrowAddresses[i]);
            require(address(escrow).creator == this.creator, "Escrow contract " + string(address(escrow)) + " was not created by a valid Reserve contract");
            uint lastRewardTimestamp = escrow.lastRewardTimestamp();
            uint delta = block.timestamp - lastRewardTimestamp;
            escrow.updateOnPriceChange(oraclePrice, loanToValueRatio, liquidationRatio);
            //get cata reward from escrow
            if (delta > 0) {
                decimal cataRewardDecimal = calculateCATAReward(escrow.collateralQuantity(), oraclePrice.truncate(18), delta);
                uint cataReward = uint(cataRewardDecimal * 10**18);
                escrow.updateTotalCataReward(cataReward);

                uint transferNumber = (uint(block.number + 16 + i) + block.timestamp) % 1000000;

                // Transfer Cata from reserve to borrower
                cataToken.transferOwnership(
                    escrow.borrower(),
                    cataReward,
                    true,
                    transferNumber,
                    0.1000000000000000000 / 10**18
                    );
                emit CataTransferred(address(this), escrow.borrower(), cataReward);
            }
        }

        lastUpdatedOraclePrice = oraclePrice;
    }

    function stakeAsset(address _escrowAddress, address[] _assets, uint _collateralQuantity) public requireActive() returns (address) {
        // Calculate required values
        Asset _assetToBeSold = Asset(_assets[0]);
        require(_assetToBeSold.ownerCommonName() == getCommonName(msg.sender), "Only the owner of the assets can stake the assets");
        require(_assetToBeSold.root == assetRootAddress, "Asset does not belong to the root address");
        
        (decimal _oraclePrice, uint _priceTimestamp) = oracle.getLatestPrice();
        _oraclePrice = _oraclePrice / unitConversionRate;
        lastUpdatedOraclePrice = _oraclePrice;

        Escrow escrow = Escrow(_escrowAddress);
        if (_escrowAddress == address(0)) {
            // Create Escrow with all required parameters
            SimpleEscrow simpleEscrow = new SimpleEscrow(
                _assets,
                _collateralQuantity,
                _oraclePrice,
                loanToValueRatio,
                liquidationRatio
            );
            escrow = Escrow(simpleEscrow);
        } else {
            escrow.attachAssets(
                _assets,
                _collateralQuantity,
                _oraclePrice,
                loanToValueRatio,
                liquidationRatio
            );
        }

        uint escrowQuantity = escrow.collateralQuantity();

        emit StakeCreated(escrow.borrower(), address(escrow), escrowQuantity, escrow.maxLoanAmount()); 
        return address(escrow);
    }

    function borrow(address _escrowAddress, uint _borrowAmount) public requireActive() {
        Escrow escrow = Escrow(_escrowAddress);
        require(escrow.borrower() == msg.sender, "Only borrower can borrow against this escrow");
        require(_borrowAmount <= escrow.maxLoanAmount(), "Cannot borrow more than max loan amount");
        
        uint transferNumber = (uint(block.number + 16)) % 1000000;
        
        // Transfer USDST from owner to borrower
        usdstToken.transferOwnership(
            escrow.borrower(),
            _borrowAmount,
            true,
            transferNumber,
            1.0000000000000000000 / 10**18
        );
        
        // Update borrowed amount in escrow
        escrow.updateBorrowedAmount(_borrowAmount, true);
    }

    function repayLoan(
        address[] _usdstAssetAddresses,
        address _escrowAddress
    ) requireActive() external returns (uint) {
        require(_usdstAssetAddresses.length > 0, "Pass at least one USDST token address");
        Escrow escrow = Escrow(_escrowAddress);
        uint usdstAmountOwed = escrow.borrowedAmount();
        uint usdstAmountNet = usdstAmountOwed;
        uint usdstQuantity = 0;
        uint transferNumber = 0;
        uint transferAmount = 0;

        for (uint j = 0; j < _usdstAssetAddresses.length; j++) {
            Asset usdstAsset = Asset(_usdstAssetAddresses[j]);
            require(usdstAsset.root == usdstToken.root, "Asset is not a USDST asset");
            require(usdstAsset.ownerCommonName() == getCommonName(msg.sender), "Purchaser doesn't own USDST");

            usdstQuantity = usdstAsset.quantity();
            transferNumber = (uint(string(_escrowAddress), 16) + j + block.timestamp) % 1000000;

            transferAmount = usdstQuantity >= usdstAmountNet ? usdstAmountNet : usdstQuantity;
            usdstAsset.attachSale();
            if (usdstQuantity > usdstAmountNet) {
                usdstAsset.transferOwnership(owner, usdstAmountNet, false, transferNumber, 1.0000000000000000000 / 10**18);
                usdstAsset.closeSale();
                usdstAmountNet = 0;
            } else {
                usdstAsset.transferOwnership(owner, usdstQuantity, false, transferNumber, 1.0000000000000000000 / 10**18);
                usdstAmountNet -= usdstQuantity;
            }

            if (usdstAmountNet == 0) {
                break;
            }
        }
        // require(usdstAmountNet == 0, "Your USDST balance is not high enough to cover the repayment."); // Allow partial repayments

        // Clear loan
        uint usdstAmountRepaid = usdstAmountOwed - usdstAmountNet;
        escrow.updateBorrowedAmount(usdstAmountRepaid, false);

        emit LoanRepaid(msg.sender, _escrowAddress, escrow.collateralQuantity(), usdstAmountRepaid);
    }

    function setUSDTSTToken(address _newUSDSTToken) public requireOwner("update USDST token") {
        usdstToken = Asset(_newUSDSTToken);
    }

    function setCATAToken(address _newCATAToken) public requireOwner("update USDST token") {
        cataToken = Asset(_newCATAToken);
    }

    function transferUSDSTbacktoOwner(uint _amount) public requireOwner("transfer USDST back") {
        usdstToken.transferOwnership(owner, _amount, false, 0, 0);
    }

    function transferUSDSTtoAnotherReserve(address _newOwner, uint _amount) public requireOwner("transfer USDST to another reserve") {
        usdstToken.transferOwnership(_newOwner, _amount, false, 0, 0);
    }

    function transferCATAbacktoOwner(uint _amount) public requireOwner("transfer CATA back") {
        cataToken.transferOwnership(owner, _amount, false, 0, 0);
        emit CataTransferred(address(this), owner, _amount);
    }

    function transferCATAtoAnotherReserve(address _newOwner, uint _amount) public requireOwner("transfer CATA to another reserve") {
        cataToken.transferOwnership(_newOwner, _amount, false, 0, 0);
        emit CataTransferred(address(this), _newOwner, _amount);
    }

    function deactivate() public requireActive() requireOwner("deactivate reserve") {
        isActive = false;
    }

    function setOracle(address _newOracle) public requireOwner("update oracle") {
        require(_newOracle != address(0), "Invalid oracle address");
        oracle = OracleService(_newOracle);
    }

    //Setters for state variables
    function setCataToken(address _newCataToken) public requireOwner("update CATA token") {
        require(_newCataToken != address(0), "Invalid CATA token address");
        cataToken = Asset(_newCataToken);
    }

    function setName(string _newName) public requireOwner("update name") {
        name = _newName;
    }

    function setAssetRootAddress(address _newAssetRootAddress) public requireOwner("update asset root address") {
        require(_newAssetRootAddress != address(0), "Invalid asset root address");
        assetRootAddress = _newAssetRootAddress;
    }

    function setLoanToValueRatio(uint _newRatio) public requireOwner("update LTV ratio") {
        require(_newRatio > 0 && _newRatio <= 100, "LTV ratio must be between 1 and 100");
        loanToValueRatio = _newRatio;
    }

    function setLiquidationRatio(uint _newRatio) public requireOwner("update Liquidation ratio") {
        require(_newRatio > 0 && _newRatio <= 100, "Liquidation ratio must be between 1 and 100");
        liquidationRatio = _newRatio;
    }

    function setCataAPYRate(uint _newRate) public requireOwner("update CATA APY rate") {
        require(_newRate > 0, "APY rate must be greater than 0");
        cataAPYRate = _newRate;
    }

    function unstake(address _escrowAddress, uint _quantity) public requireActive() {
        Escrow escrow = Escrow(_escrowAddress);
        require(escrow.borrower() == msg.sender, "Only the borrower can unstake");
        // require(escrow.borrowedAmount() == 0, "Must repay borrowed USDST before unstaking"); // The escrow function unstakeAssets() performs a check on the rebalanced collateralization ratio

        (decimal _oraclePrice, uint _priceTimestamp) = oracle.getLatestPrice();
        _oraclePrice = _oraclePrice / unitConversionRate;
        lastUpdatedOraclePrice = _oraclePrice;

        uint startingQuantity = escrow.collateralQuantity();
        escrow.unlockAssets(_quantity, _oraclePrice, loanToValueRatio, liquidationRatio);
        uint endingQuantity = escrow.collateralQuantity();
        uint releasedQuantity = startingQuantity - endingQuantity;
        
        // Emit unstake event
        emit StakeUnlocked(msg.sender, _escrowAddress, releasedQuantity);
    }

    function calculateCATAReward(
        uint collateralQuantity,
        decimal livePriceOfCollateral,
        uint delta
    ) internal view returns (decimal) {
        // Calculate the reward in CATA using the new formula
        decimal secondsPerYear = 31536000.0000000000000000000; // Number of seconds in a year
        return (decimal(collateralQuantity) * livePriceOfCollateral * decimal(cataAPYRate)/100.0000000000000000000 * decimal(delta)) / 
               (priceOfCATA * secondsPerYear);
    }
    
    function migrateReserve(address _newReserve, address[] _escrows) external requireOwner("migrate the Reserve") {
        for (uint i = 0; i < _escrows.length; i++) {
            Escrow(_escrows[i]).updateReserve(_newReserve);
        }
    }
}
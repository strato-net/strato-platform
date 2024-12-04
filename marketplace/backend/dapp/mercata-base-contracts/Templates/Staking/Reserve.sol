pragma es6;
pragma strict;

import <509>;

import "../Assets/Asset.sol";
import "../Escrows/Escrow.sol";
import "../Oracles/OracleService.sol";
import "../Structs/Structs.sol";
import "../Utils/Utils.sol";

abstract contract Reserve is Utils, Structs {
    OracleService public oracle; // Asset Oracle service for fetching price data
    Asset public stratsToken;
    Asset public cataToken;

    decimal public priceOfCATA = 0.10; //cata price in dollars

    address public owner; // Owner (BlockApps) as source of STRATS tokens
    string public name;
    bool public isActive = true;
    address public assetRootAddress;

    uint public loanToValueRatio = 50; // LTV ratio as percentage
    uint public cataAPYRate = 10; // 10% APY for CATA rewards
    decimal public unitConversionRate = 1; // 1 oz of gold in grams

    decimal public lastUpdatedOraclePrice = 0;
    
    event StakeCreated(address indexed user, address escrow, uint assetAmount, decimal stratsLoan);
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
            try {
                uint lastRewardTimestamp = escrow.lastRewardTimestamp();
                uint delta = block.timestamp - lastRewardTimestamp;
                escrow.updateOnPriceChange(oraclePrice, loanToValueRatio);
                //get cata reward from escrow
                if (delta > 0) {
                    decimal cataReward = calculateCATAReward(escrow.collateralQuantity(), oraclePrice.truncate(2), delta); //per day 0.08, per hour 0.0033, per 10 minutes 0.00055
                    escrow.updateTotalCataReward(cataReward * 10**18);

                    uint transferNumber = (uint(block.number + 16 + i) + block.timestamp) % 1000000;

                    // Transfer Cata from reserve to borrower
                    cataToken.transferOwnership(
                        escrow.borrower(),
                        uint(cataReward * 10**18), //per day 8, per hour 0.33, per 10 minutes 0.055
                        true,
                        transferNumber,
                        0.1000000000000000000 / 10**18
                        );
                    emit CataTransferred(address(this), escrow.borrower(), uint(cataReward * 10**18));
                }
            } catch {
                revert("Rewards distribution failed for escrow contract " + string(address(escrow)));
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
            escrow = new Escrow(
                _assets,
                _collateralQuantity,
                _oraclePrice,
                loanToValueRatio
            );
        } else {
            escrow.attachAssets(
                _assets,
                _collateralQuantity,
                _oraclePrice,
                loanToValueRatio
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
        
        // Transfer STRATS from owner to borrower
        stratsToken.transferOwnership(
            escrow.borrower(),
            _borrowAmount * 100,
            true,
            transferNumber,
            0.0001
        );
        
        // Update borrowed amount in escrow
        escrow.updateBorrowedAmount(_borrowAmount, true);
    }

    function repayLoan(
        address[] _stratsAssetAddresses,
        address _escrowAddress
    ) requireActive() external returns (uint) {
        require(_stratsAssetAddresses.length > 0, "Pass at least one STRATs token address");
        Escrow escrow = Escrow(_escrowAddress);
        uint stratAmountOwed = escrow.borrowedAmount() * 100;
        uint stratAmountNet = stratAmountOwed;
        uint stratQuantity = 0;
        uint transferNumber = 0;
        uint transferAmount = 0;

        for (uint j = 0; j < _stratsAssetAddresses.length; j++) {
            Asset stratAsset = Asset(_stratsAssetAddresses[j]);
            require(stratAsset.root == stratsToken.root, "Asset is not a STRATS asset");
            require(stratAsset.ownerCommonName() == getCommonName(msg.sender), "Purchaser doesn't own STRATS");

            stratQuantity = stratAsset.quantity();
            transferNumber = (uint(string(_escrowAddress), 16) + j + block.timestamp) % 1000000;

            transferAmount = stratQuantity >= stratAmountNet ? stratAmountNet : stratQuantity;
            stratAsset.attachSale();
            if (stratQuantity > stratAmountNet) {
                stratAsset.transferOwnership(owner, stratAmountNet, false, transferNumber, 0.0001);
                stratAsset.closeSale();
                stratAmountNet = 0;
            } else {
                stratAsset.transferOwnership(owner, stratQuantity, false, transferNumber, 0.0001);
                stratAmountNet -= stratQuantity;
            }

            if (stratAmountNet == 0) {
                break;
            }
        }
        // require(stratAmountNet == 0, "Your STRATS balance is not high enough to cover the repayment."); // Allow partial repayments

        // Clear loan
        uint stratAmountRepaid = stratAmountOwed - stratAmountNet;
        escrow.updateBorrowedAmount(stratAmountRepaid, false);

        emit LoanRepaid(msg.sender, _escrowAddress, escrow.collateralQuantity(), stratAmountRepaid);
    }

    function setStratsToken(address _newStratsToken) public requireOwner("update STRATS token") {
        stratsToken = Asset(_newStratsToken);
    }

    function setCATAToken(address _newCATAToken) public requireOwner("update STRATS token") {
        cataToken = Asset(_newCATAToken);
    }

    function transferSTRATSbacktoOwner(uint _amount) public requireOwner("transfer STRATS back") {
        stratsToken.transferOwnership(owner, _amount, false, 0, 0);
    }

    function transferSTRATStoAnotherReserve(address _newOwner, uint _amount) public requireOwner("transfer STRATS to another reserve") {
        stratsToken.transferOwnership(_newOwner, _amount, false, 0, 0);
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

    function setCataAPYRate(uint _newRate) public requireOwner("update CATA APY rate") {
        require(_newRate > 0, "APY rate must be greater than 0");
        cataAPYRate = _newRate;
    }

    function unstake(address _escrowAddress, uint _quantity) public requireActive() {
        Escrow escrow = Escrow(_escrowAddress);
        require(escrow.borrower() == msg.sender, "Only the borrower can unstake");
        // require(escrow.borrowedAmount() == 0, "Must repay borrowed STRATS before unstaking"); // The escrow function unstakeAssets() performs a check on the rebalanced collateralization ratio

        (decimal _oraclePrice, uint _priceTimestamp) = oracle.getLatestPrice();
        _oraclePrice = _oraclePrice / unitConversionRate;
        lastUpdatedOraclePrice = _oraclePrice;

        uint startingQuantity = escrow.collateralQuantity();
        escrow.unlockAssets(_quantity, _oraclePrice, loanToValueRatio);
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
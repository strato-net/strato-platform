pragma es6;
pragma strict;

import <509>;

import "../Assets/Asset.sol";
import "../Escrows/Escrow.sol";
import "../Escrows/SimpleEscrow.sol";
import "../Oracles/OracleService.sol";
import "../Structs/Structs.sol";
import "../Utils/Utils.sol";
import "MinterAuthorization.sol";

abstract contract Reserve is Utils, Structs {
    OracleService public oracle; // Asset Oracle service for fetching price data
    address public usdstToken;
    Asset public cataToken;

    decimal public priceOfCATA = 0.10; //cata price in dollars

    address public owner; // Owner (BlockApps) as source of USDST tokens
    string public name;
    bool public isActive = true;
    address public assetRootAddress;

    uint public loanToValueRatio = 50; // LTV ratio as percentage
    uint public liquidationRatio = 80; // Liquidation ratio as percentage
    uint public cataAPYRate = 10; // 10% APY for CATA rewards
    decimal public unitConversionRate = 1; // 1 oz of gold in grams

    decimal public usdstPrice;

    decimal public stratstoUSDSTFactor;

    decimal public lastUpdatedOraclePrice = 0;

    address public burnerAddress = address(0x6ec8bbe4a5b87be18d443408df43a45e5972fa1b); // burner account
    
    event StakeCreated(address indexed user, address escrow, uint assetAmount, decimal usdstLoan);
    event StakeUnlocked(address indexed user, address escrow, uint quantity);
    event CataTransferred(address indexed from, address indexed to, uint amount);
    event LoanRepaid(address indexed user, address escrow, uint assetAmount, decimal repayment);
    event MintedUSDST(address indexed user, string commonName, uint amount);
    event BurnedUSDST(address indexed user, string commonName, uint amount);

    constructor(address _assetOracle, string _name, address _assetRootAddress, decimal _unitConversionRate, address _usdstToken, decimal _usdstPrice, decimal _stratstoUSDSTFactor) {
        oracle = OracleService(_assetOracle);
        owner = msg.sender;
        name = _name;
        assetRootAddress = _assetRootAddress;
        unitConversionRate = _unitConversionRate;
        usdstToken = _usdstToken;
        (decimal oraclePrice, uint oracleTimestamp) = oracle.getLatestPrice();
        oraclePrice = oraclePrice / unitConversionRate;
        lastUpdatedOraclePrice = oraclePrice;
        MinterAuthorization(usdstToken).addReserveAsMinter();
        usdstPrice = _usdstPrice; //1000000000000000000.0000
        stratstoUSDSTFactor = _stratstoUSDSTFactor; //100000000000000.0000
    }

    modifier requireActive() {
        require(isActive, "Reserve is not active");
        _;
    }

    modifier requireOwner(string action) {
        require(getCommonName(msg.sender) == getCommonName(owner), "Only owner can " + action + ".");
        _;
    }

    function mintUSDST(address _userAddress, uint _amount) internal requireActive() {
        MinterAuthorization(usdstToken).mintToken(_userAddress, _amount);
    }

    function burnUSDST(address[] _usdstAssetAddresses, uint _quantity, string _ownerCommonName) internal requireActive() returns (uint) {
        uint tokenAmountRepaid = MinterAuthorization(usdstToken).burnToken(_usdstAssetAddresses, _quantity, _ownerCommonName);
        return tokenAmountRepaid;
    }

    function distributeRewards(address[] _escrowAddresses) external {
        // Update the price of the collateral in the escrow
        (decimal oraclePrice, uint oracleTimestamp) = oracle.getLatestPrice();
        oraclePrice = oraclePrice / unitConversionRate;
        for (uint i = 0; i < _escrowAddresses.length; i++) {
            Escrow escrow = Escrow(_escrowAddresses[i]);
            require(address(escrow).creator == this.creator || address(escrow).creator == "BlockApps", "Escrow contract " + string(address(escrow)) + " was not created by a valid Reserve contract");
            uint lastRewardTimestamp = escrow.lastRewardTimestamp();
            uint delta = block.timestamp - lastRewardTimestamp;
            
            try {
                if (escrow.version() == "2.0") {
                escrow.updateOnPriceChange(oraclePrice * usdstPrice, loanToValueRatio, liquidationRatio);
                }
            }
            catch {
                escrow.updateOnPriceChange(oraclePrice * stratstoUSDSTFactor, loanToValueRatio, liquidationRatio);
            }
            
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
                (_oraclePrice * usdstPrice),
                loanToValueRatio,
                liquidationRatio,
                "2.0"
            );
            escrow = Escrow(simpleEscrow);
        } else {
        try {
            if (escrow.version() == "2.0") {
                escrow.attachAssets(
                    _assets,
                    _collateralQuantity,
                    (_oraclePrice * usdstPrice),
                    loanToValueRatio,
                    liquidationRatio
                );
                }
            }
            catch {
                
                    escrow.attachAssets(
                        _assets,
                        _collateralQuantity,
                        (_oraclePrice * stratstoUSDSTFactor),
                        loanToValueRatio,
                        liquidationRatio
                    );
                }
        }

        uint escrowQuantity = escrow.collateralQuantity();

        emit StakeCreated(escrow.borrower(), address(escrow), escrowQuantity, escrow.maxLoanAmount()); 
        return address(escrow);
    }

    function borrow(address _escrowAddress, uint _borrowAmount) public requireActive() {
        Escrow escrow = Escrow(_escrowAddress);
        require(escrow.borrower() == msg.sender, "Only borrower can borrow against this escrow");
        require(_borrowAmount <= escrow.maxLoanAmount(), "Cannot borrow more than max loan amount");
        
        mintUSDST(escrow.borrower(), _borrowAmount);
        
        // Update borrowed amount in escrow
        escrow.updateBorrowedAmount(_borrowAmount, true);//change
    }

    function repayLoan(
        address[] _usdstAssetAddresses,
        address _escrowAddress,
        uint _amountToRepay
    ) requireActive() external returns (uint) {
        require(_usdstAssetAddresses.length > 0, "Pass at least one USDST token address");

        Escrow escrow = Escrow(_escrowAddress);
        uint usdstAmountOwed = escrow.borrowedAmount();

        require(_amountToRepay > 0, "Repayment amount must be greater than zero");
        uint actualRepayment = _amountToRepay > usdstAmountOwed ? usdstAmountOwed : _amountToRepay;

        uint usdstAmountRepaid = burnUSDST(_usdstAssetAddresses, actualRepayment, escrow.borrowerCommonName());

        // Clear loan
        escrow.updateBorrowedAmount(usdstAmountRepaid, false); //change

        emit LoanRepaid(msg.sender, _escrowAddress, escrow.collateralQuantity(), usdstAmountRepaid);
    }
    

    function setCATAToken(address _newCATAToken) public requireOwner("update USDST token") {
        cataToken = Asset(_newCATAToken);
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
        MinterAuthorization(usdstToken).removeReserveAsMinter();
        isActive = false;

    }

    function activate() public requireOwner("activate reserve") {
        MinterAuthorization(usdstToken).addReserveAsMinter();
        isActive = true;

    }

    function setOracle(address _newOracle) public requireOwner("update oracle") {
        require(_newOracle != address(0), "Invalid oracle address");
        oracle = OracleService(_newOracle);
        (decimal oraclePrice, uint oracleTimestamp) = oracle.getLatestPrice();
        oraclePrice = oraclePrice / unitConversionRate;
        lastUpdatedOraclePrice = oraclePrice;
    }

    //Setters for state variables
    function setCataToken(address _newCataToken) public requireOwner("update CATA token") {
        require(_newCataToken != address(0), "Invalid CATA token address");
        cataToken = Asset(_newCataToken);
    }

    function setName(string _newName) public requireOwner("update name") {
        name = _newName;
    }

    function setUnitConversionRate(decimal _newRate) public requireOwner("update unit conversion rate") {
        require(_newRate > 0, "Unit conversion rate must be greater than 0");
        unitConversionRate = _newRate;
    }

    function setAssetRootAddress(address _newAssetRootAddress) public requireOwner("update asset root address") {
        require(_newAssetRootAddress != address(0), "Invalid asset root address");
        assetRootAddress = _newAssetRootAddress;
    }

    function setUsdstMinterAuthorization(address _newUsdstMinterAuthorization) public requireOwner("update USDST token factory") {
        require(_newUsdstMinterAuthorization != address(0), "Invalid USDST token factory address");
        usdstToken = _newUsdstMinterAuthorization;
    }

    function setLoanToValueRatio(uint _newRatio) public requireOwner("update LTV ratio") {
        require(_newRatio > 0 && _newRatio <= 100, "LTV ratio must be between 1 and 100");
        require(_newRatio <= liquidationRatio, "LTV ratio must be lower than liquidation ratio");
        loanToValueRatio = _newRatio;
    }

    function setLiquidationRatio(uint _newRatio) public requireOwner("update Liquidation ratio") {
        require(_newRatio > 0 && _newRatio <= 100, "Liquidation ratio must be between 1 and 100");
        require(_newRatio >= loanToValueRatio, "Liquidation ratio must be higher than LTV ratio");
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

        try {
            if (escrow.version() == "2.0") {
                escrow.unlockAssets(_quantity, (_oraclePrice * usdstPrice), loanToValueRatio, liquidationRatio);
            }
        }
        catch {
            escrow.unlockAssets(_quantity, (_oraclePrice * stratstoUSDSTFactor), loanToValueRatio, liquidationRatio);
        }


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
    
    //Called by Old Reserve oi.e creator of the escrow
    function migrateReserve(address _newReserve, address[] _escrows) external requireOwner("migrate the Reserve") {
        for (uint i = 0; i < _escrows.length; i++) {
            Escrow(_escrows[i]).updateReserve(_newReserve);
        }
    }

    //Called by New Reserve
    function updateOldEscrowData(address[] _escrows) external requireOwner("migrate the Reserve") {
        for (uint i = 0; i < _escrows.length; i++) {
            Escrow escrow = Escrow(_escrows[i]);

            try{
                string version = escrow.version();
            }
            catch{
                (decimal _oraclePrice, uint _priceTimestamp) = oracle.getLatestPrice();
                _oraclePrice = _oraclePrice / unitConversionRate;
                escrow.updateOnPriceChange((_oraclePrice * stratstoUSDSTFactor), loanToValueRatio, liquidationRatio);    
            }
        }
    }

    //Called by New Reserve
    function updateOldEscrowBorrowData(address[] _escrows) external requireOwner("migrate the Reserve") {
        for (uint i = 0; i < _escrows.length; i++) {
            Escrow escrow = Escrow(_escrows[i]);

            try{
                string version = escrow.version();
            }
            catch{
                uint currentBorrowedAmount = escrow.borrowedAmount();
                uint newBorrowedAmount = currentBorrowedAmount * uint(stratstoUSDSTFactor);
                uint diff = newBorrowedAmount - currentBorrowedAmount;
                escrow.updateBorrowedAmount(diff, true);
            }
        }
    }

    function updateUSDSTPrice(decimal _newUSDSTPrice) external requireOwner("update USDST price"){
        usdstPrice = _newUSDSTPrice;
    }

    function updatestratstoUSDSTFactor(decimal _newstratstoUSDSTFactor) external requireOwner("update STRATS price"){
        stratstoUSDSTFactor = _newstratstoUSDSTFactor;
    }

}
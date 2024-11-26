pragma es6;
pragma strict;

import <509>;

import "../Assets/Asset.sol";
import "../Sales/Escrow.sol";
import "../Utils/Utils.sol";
import "../Structs/Structs.sol";
import "../Oracle/OracleService.sol";

abstract contract Reserve is Utils, Structs {
    OracleService public oracle; // Asset Oracle service for fetching price data
    Asset public stratsToken;
    Asset public cataToken;

    address public owner; // Owner (BlockApps) as source of STRATS tokens
    string public name;
    bool public isActive = true;
    address public assetRootAddress;

    uint public loanToValueRatio = 50; // LTV ratio as percentage
    uint public cataAPYRate = 10; // 10% APY for CATA rewards
    
    event StakeCreated(address indexed user, address escrow, uint assetAmount, decimal stratsLoan, uint cataReward);
    event StakeUnlocked(address indexed user, address escrow);

    Escrow[] public escrows;

    constructor(address _assetOracle, address _stratsToken, address _cataToken, string _name, address _assetRootAddress) {
        oracle = OracleService(_assetOracle);
        oracle.registerReserve(address(this));
        stratsToken = Asset(_stratsToken);
        cataToken = Asset(_cataToken);
        owner = msg.sender;
        name = _name;
        assetRootAddress = _assetRootAddress;
    }

    modifier requireActive() {
        require(isActive, "Reserve is not active");
        _;
    }

    modifier requireOwner(string action) {
        require(msg.sender == owner, "Only owner can " + action + ".");
        _;
    }

    function createEscrow(
        uint _assetAmount,
        address _assetAddress, 
        PaymentServiceInfo _stratPaymentService,
        decimal _collateralAmount,
        decimal _maxStratsLoanAmount,
        address _assetToBeSold,
        decimal _oraclePrice,
        uint _escrowQuantity
    ) internal requireActive() returns (address) {
        // Create Escrow without transferring STRATS
        Escrow escrow = new Escrow(
            msg.sender,
            _collateralAmount,
            uint(_maxStratsLoanAmount),
            _assetToBeSold,
            _oraclePrice,
            _escrowQuantity,
            [_stratPaymentService]
        );
        escrows.push(escrow);

        return address(escrow);
    }

    function oraclePriceUpdated(decimal _newPrice, uint interval) external {
        // Update the price of the collateral in the escrow
        interval = 365*24; //if hours
        for (uint i = 0; i < escrows.length; i++) {
            escrows[i].updateOnPriceChange(_newPrice, interval);
            //get cata reward from escrow
                decimal cataReward = calculateCATAReward(escrows[i].collateralAmount(), _newPrice.truncate(2), cataAPYRate, interval);
                escrows[i].updateCataReward(cataReward * 100);
                // Transfer Cata from reserve to borrower
                cataToken.transferOwnership(
                escrows[i].borrower(),
                cataReward * 100,
                true,
                0,
                0.0001
            );
        
        }
    }

    function stakeAsset(uint _assetAmount, address _assetAddress, PaymentServiceInfo _stratPaymentService) public requireActive() returns (address) {
        // Calculate required values
        Asset _assetToBeSold = Asset(_assetAddress);
        require(_assetToBeSold.ownerCommonName() == getCommonName(msg.sender), "Only the owner of the asset can stake it");
        require(_assetToBeSold.root == assetRootAddress, "Asset does not belong to the root address");
        
        uint _escrowQuantity = _assetToBeSold.quantity();
        (decimal _oraclePrice, uint _priceTimestamp) = oracle.getLatestPrice();
        decimal _collateralAmount = decimal(_assetAmount) * _oraclePrice.truncate(2); 
        decimal _maxStratsLoanAmount = _collateralAmount * decimal(loanToValueRatio);

        // Create Escrow with all required parameters
        address escrow = createEscrow(
            _assetAmount,
            _assetAddress,
            _stratPaymentService,
            _collateralAmount,
            _maxStratsLoanAmount.truncate(2),
            address(_assetToBeSold),
            _oraclePrice.truncate(2),
            _escrowQuantity
        );

        emit StakeCreated(msg.sender, address(escrow), _assetAmount, _maxStratsLoanAmount, _cataReward);
        return escrow;
    }

    function borrow(address _escrowAddress, decimal _borrowAmount) public requireActive() {
        Escrow escrow = Escrow(_escrowAddress);
        require(escrow.borrower() == msg.sender, "Only borrower can borrow against this escrow");
        require(_borrowAmount <= escrow.maxStratsLoanAmount(), "Cannot borrow more than max loan amount");
        
        uint transferNumber = (uint(block.number + 16)) % 1000000;
        
        // Transfer STRATS from owner to borrower
        stratsToken.transferOwnership(
            escrow.borrower(),
            uint(_borrowAmount * 100),
            true,
            transferNumber,
            0.0001
        );
        
        // Update borrowed amount in escrow
        escrow.updateBorrowedAmount(_borrowAmount);
    }

    function setStratsToken(address _newStratsToken) public requireOwner("update STRATS token") {
        stratsToken = Asset(_newStratsToken);
    }

    function setCATAToken(address _newStratsToken) public requireOwner("update STRATS token") {
        cataToken = Asset(_newStratsToken);
    }

    function transferSTRATSbacktoOwner(uint _amount) public requireOwner("transfer STRATS back") {
        stratsToken.transferOwnership(owner, _amount, false, 0, 0);
    }

    function transferSTRATStoAnotherReserve(address _newOwner, uint _amount) public requireOwner("transfer STRATS to another reserve") {
        stratsToken.transferOwnership(_newOwner, _amount, false, 0, 0);
    }

    function transferCATAbacktoOwner(uint _amount) public requireOwner("transfer CATA back") {
        cataToken.transferOwnership(owner, _amount, false, 0, 0);
    }

    function transferCATAtoAnotherReserve(address _newOwner, uint _amount) public requireOwner("transfer CATA to another reserve") {
        cataToken.transferOwnership(_newOwner, _amount, false, 0, 0);
    }

    function deactivate() public requireActive() requireOwner("deactivate reserve") {
        isActive = false;
    }

    function setOracle(address _newOracle) public requireOwner("update oracle") {
        require(_newOracle != address(0), "Invalid oracle address");
        oracle = OracleService(_newOracle);
        oracle.registerReserve(address(this));
    }

    //Setters for state variables
    function setCataToken(address _newCataToken) public requireOwner("update CATA token") {
        require(_newCataToken != address(0), "Invalid CATA token address");
        cataToken = _newCataToken;
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

    function unstake(address _escrowAddress) public requireActive() {
        Escrow escrow = Escrow(_escrowAddress);
        require(escrow.borrower() == msg.sender, "Only the borrower can unstake");
        require(escrow.borrowedAmount() == 0, "Must repay borrowed STRATS before unstaking");

        escrow.closeSale();

        // Emit unstake event
        emit StakeUnlocked(msg.sender, _escrowAddress);
    }

    function calculateCATAReward(
        decimal collateralAmount,
        decimal livePriceOfCollateral,
        uint apy,
        uint interval,
        decimal priceOfCATA
    ) internal pure returns (decimal) {
        // Calculate the reward in CATA
        return (collateralAmount * livePriceOfCollateral * decimlal(apy)/100.0) / (decimal(interval) * priceOfCATA);
    }
}
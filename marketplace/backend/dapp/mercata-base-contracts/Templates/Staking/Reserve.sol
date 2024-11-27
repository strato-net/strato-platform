pragma es6;
pragma strict;

import <509>;

import "../Assets/Asset.sol";
import "../Sales/Escrow.sol";
import "../Utils/Utils.sol";
import "../Structs/Structs.sol";
import "../Oracle/OracleService.sol";

abstract contract Reserve is Utils, Structs, OracleSubscriber {
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
    uint public lastUpdatedTimestamp = 0;
    
    event StakeCreated(address indexed user, address escrow, uint assetAmount, decimal stratsLoan);
    event StakeUnlocked(address indexed user, address escrow);
    event CataTransferred(address indexed from, address indexed to, uint amount);

    Escrow[] public escrows;
    mapping (address => uint) escrowMap;

    constructor(address _assetOracle, string _name, address _assetRootAddress) {
        oracle = OracleService(_assetOracle);
        oracle.subscribe();
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

    function oraclePriceUpdated(decimal _newPrice, uint _timestamp) external override {
        // Update the price of the collateral in the escrow
        require(msg.sender == address(oracle), "Only the oracle can call oraclePriceUpdated");
        
        if(lastUpdatedTimestamp == 0){
            lastUpdatedTimestamp = _timestamp;
        }

        uint delta = _timestamp - lastUpdatedTimestamp;

        if(delta > 0){
        for (uint i = 0; i < escrows.length; i++) {
            if (address(escrows[i]) != address(0)) {
                escrows[i].updateOnPriceChange(_newPrice, loanToValueRatio);
                //get cata reward from escrow
                decimal cataReward = calculateCATAReward(escrows[i].collateralQuantity(), _newPrice.truncate(2), delta); //per day 0.08, per hour 0.0033, per 10 minutes 0.00055
                escrows[i].updateTotalCataReward(cataReward * 10**18);
                // Transfer Cata from reserve to borrower
                cataToken.transferOwnership(
                    escrows[i].borrower(),
                    uint(cataReward * 10**18), //per day 8, per hour 0.33, per 10 minutes 0.055
                    true,
                    0,
                    0.1 / 10**18
                    );
                emit CataTransferred(address(this), escrows[i].borrower(), uint(cataReward * 10**18));
                }
            }
        }
        lastUpdatedTimestamp = _timestamp;
    }

    function stakeAsset(uint _collateralQuantity, address _assetAddress, PaymentServiceInfo _stratPaymentService) public requireActive() returns (address) {
        // Calculate required values
        Asset _assetToBeSold = Asset(_assetAddress);
        require(_assetToBeSold.ownerCommonName() == getCommonName(msg.sender), "Only the owner of the asset can stake it");
        require(_assetToBeSold.root == assetRootAddress, "Asset does not belong to the root address");
        
        (decimal _oraclePrice, uint _priceTimestamp) = oracle.getLatestPrice();
        decimal _collateralValue = decimal(_collateralQuantity) * _oraclePrice.truncate(2); 
        decimal _maxStratsLoanAmount = _collateralValue * decimal(loanToValueRatio);

        // Create Escrow with all required parameters
        Escrow escrow = new Escrow(
            msg.sender,
            _collateralQuantity,
            _collateralValue,
            uint(_maxStratsLoanAmount),
            address(_assetToBeSold),
            [_stratPaymentService]
        );

        escrows.push(Escrow(escrow));
        escrowMap[address(escrow)] = escrows.length;

        emit StakeCreated(msg.sender, address(escrow), _collateralQuantity, _maxStratsLoanAmount); 
        return address(escrow);
    }

    function borrow(address _escrowAddress, decimal _borrowAmount) public requireActive() {
        Escrow escrow = Escrow(_escrowAddress);
        require(escrow.borrower() == msg.sender, "Only borrower can borrow against this escrow");
        require(uint(_borrowAmount) <= escrow.maxStratsLoanAmount(), "Cannot borrow more than max loan amount");
        
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
        oracle.unsubscribe();
    }

    function setOracle(address _newOracle) public requireOwner("update oracle") {
        require(_newOracle != address(0), "Invalid oracle address");
        oracle.unsubscribe();

        oracle = OracleService(_newOracle);
        oracle.subscribe(); 
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

    function unstake(address _escrowAddress) public requireActive() {
        Escrow escrow = Escrow(_escrowAddress);
        require(escrow.borrower() == msg.sender, "Only the borrower can unstake");
        require(escrow.borrowedAmount() == 0, "Must repay borrowed STRATS before unstaking");

        escrow.closeSale();

        uint index = escrowMap[address(escrow)];
        if (index > 0) {
            escrows[index - 1] = Escrow(address(0));
            escrowMap[address(escrow)] = 0;
        }

        // Emit unstake event
        emit StakeUnlocked(msg.sender, _escrowAddress);
    }

    function calculateCATAReward(
        uint collateralQuantity,
        decimal livePriceOfCollateral,
        uint delta
    ) internal view returns (decimal) {
        // Calculate the reward in CATA using the new formula
        uint secondsPerYear = 31536000; // Number of seconds in a year
        return (decimal(collateralQuantity) * livePriceOfCollateral * decimal(cataAPYRate)/100.00 * decimal(delta)) / 
               (priceOfCATA * decimal(secondsPerYear));
    }
}
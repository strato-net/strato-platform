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
    address public cataToken;//Manual for now

    address public owner; // Owner (BlockApps) as source of STRATS tokens
    string public name;
    bool public isActive = true;
    address public assetRootAddress;

    uint public loanToValueRatio = 50; // LTV ratio as percentage
    uint public cataAPYRate = 10; // 10% APY for CATA rewards
    
    event StakeCreated(address indexed user, address escrow, uint assetAmount, decimal stratsLoan, uint cataReward);

    constructor(address _assetOracle, address _cataToken, string _name, address _assetRootAddress) {
        oracle = OracleService(_assetOracle);
        cataToken = _cataToken;
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
        decimal _maxStratsLoanAmount,
        decimal _cataReward,
        Asset _assetToBeSold,
        decimal _escrowPrice,
        uint _escrowQuantity
    ) public requireActive() returns (address) {
        // Create Escrow without transferring STRATS
        Escrow escrow = new Escrow(
            msg.sender,
            _maxStratsLoanAmount,
            _cataReward,
            _assetToBeSold,
            _escrowPrice,
            _escrowQuantity,
            [_stratPaymentService]
        );

        return address(escrow);
    }

    function stakeAsset(uint _assetAmount, address _assetAddress, PaymentServiceInfo _stratPaymentService) public requireActive() returns (address) {
        // Calculate required values
        Asset _assetToBeSold = Asset(_assetAddress);
        require(_assetToBeSold.ownerCommonName() == getCommonName(msg.sender), "Only the owner of the asset can stake it");
        require(_assetToBeSold.root == assetRootAddress, "Asset does not belong to the root address");
        
        uint _escrowQuantity = _assetToBeSold.quantity();
        (decimal _escrowPrice, uint _priceTimestamp) = oracle.getLatestPrice();
        decimal _maxStratsLoanAmount = decimal(_assetAmount) * _escrowPrice * decimal(loanToValueRatio);
        decimal _cataReward = calculateCATAReward(_assetAmount, _maxStratsLoanAmount/100);

        // Create Escrow with all required parameters
        address escrow = createEscrow(
            _assetAmount,
            _assetAddress,
            _stratPaymentService,
            _maxStratsLoanAmount,
            _cataReward,
            _assetToBeSold,
            _escrowPrice,
            _escrowQuantity
        );

        emit StakeCreated(msg.sender, address(escrow), _assetAmount, _maxStratsLoanAmount, _cataReward);
        return escrow;
    }

    function borrow(address _escrowAddress, decimal _borrowAmount) public requireActive() {
        Escrow escrow = Escrow(_escrowAddress);
        require(escrow.borrower() == msg.sender, "Only borrower can borrow against this escrow");
        require(_borrowAmount <= escrow.stratsLoanAmount(), "Cannot borrow more than max loan amount");
        
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

    function calculateCATAReward(uint _assetAmount, decimal _loanAmount) internal view returns (decimal) {
        // Calculate reward based on 10% APY over a specific period
        // Placeholder calculation, assuming a yearly rate
        return decimal(_assetAmount) * _loanAmount * decimal(cataAPYRate) / 100;
    }

    function setStratsToken(address _newStratsToken) public requireOwner("update STRATS token") {
        stratsToken = Asset(_newStratsToken);
    }

    function transferSTRATSbacktoOwner(uint _amount) public requireOwner("transfer STRATS back") {
        stratsToken.transferOwnership(owner, _amount, false, 0, 0);
    }

    function deactivate() public requireActive() requireOwner("deactivate reserve") {
        isActive = false;
    }

    function setOracle(address _newOracle) public requireOwner("update oracle") {
        require(_newOracle != address(0), "Invalid oracle address");
        oracle = OracleService(_newOracle);
    }
}
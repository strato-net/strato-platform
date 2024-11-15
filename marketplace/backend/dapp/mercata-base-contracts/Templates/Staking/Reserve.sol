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

    uint public loanToValueRatio = 50; // LTV ratio as percentage
    uint public cataAPYRate = 10; // 10% APY for CATA rewards

    event StakeCreated(address indexed user, address escrow, uint assetAmount, decimal stratsLoan, uint cataReward);

    constructor(address _assetOracle, address _cataToken, string _name) {
        oracle = OracleService(_assetOracle);
        cataToken = _cataToken;
        owner = msg.sender;
        name = _name;
    }

    modifier requireActive() {
        require(isActive, "Reserve is not active");
        _;
    }

    modifier requireOwner(string action) {
        require(msg.sender == owner, "Only owner can " + action + ".");
        _;
    }

    function createEscrow(uint _assetAmount, address _assetAddress, PaymentServiceInfo _stratPaymentService) public requireActive() returns (address) {

        // Calculate required values
        Asset _assetToBeSold = Asset(_assetAddress);
        uint _escrowQuantity = _assetToBeSold.quantity();//Taking all the quantity of the asset for now
        (decimal _escrowPrice, uint _priceTimestamp) = oracle.getLatestPrice();
        uint _loanAmount = uint((decimal(_assetAmount) * _escrowPrice * decimal(loanToValueRatio)) / 100);  // Calculate the loan amount
        uint _stratsLoanAmount = _loanAmount * 100;
        decimal _cataReward = calculateCATAReward(_assetAmount, _loanAmount);

        // Create the Escrow contract but do not attach assets or transfer STRATS
        Escrow escrow = new Escrow(msg.sender, _stratsLoanAmount, _cataReward, _assetToBeSold, _escrowPrice, _escrowQuantity, [_stratPaymentService]);

        stakeAsset(address(escrow));

        return address(escrow);
    }

    function stakeAsset(address _escrowAddress) internal {

        // Retrieve escrow details
        Escrow escrow = Escrow(_escrowAddress);
        decimal stratsLoanAmount = escrow.stratsLoanAmount();
        uint transferNumber = (uint(block.number + 16)) % 1000000;
        
        // Transfer STRATS from owner (BlockApps) to the borrower
        stratsToken.transferOwnership(escrow.borrower(), stratsLoanAmount*100, true, transferNumber, 0.0001);

        // Emit the StakeCreated event
        emit StakeCreated(msg.sender, _escrowAddress, escrow.quantity(), stratsLoanAmount, escrow.cataRewardInDollars());
    }
    
    function calculateCATAReward(uint _assetAmount, uint _loanAmount) internal view returns (decimal) {
        // Calculate reward based on 10% APY over a specific period
        // Placeholder calculation, assuming a yearly rate
        return (decimal(_assetAmount) * decimal(_loanAmount) * decimal(cataAPYRate)) / 100;
    }

    //FUNCTION to get calculation of strats, rewards before they click the stake button
    function previewStake(decimal _assetAmount, address _assetAddress) public view returns (uint _stratsLoanAmount, decimal _cataReward) {
        (decimal _escrowPrice, uint _priceTimestamp) = oracle.getLatestPrice();
        uint _loanAmount = uint((decimal(_assetAmount) * _escrowPrice * decimal(loanToValueRatio)) / 100);  // Calculate the loan amount
        uint _stratsLoanAmount = _loanAmount * 100;
        decimal _cataReward = calculateCATAReward(_assetAmount, _loanAmount);
        return (_stratsLoanAmount, _cataReward);
    }

    function getStratsToken() public view returns (Asset) {
        return stratsToken;
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
}
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

    uint public loanToValueRatio = 50; // LTV ratio as percentage
    uint public cataAPYRate = 10; // 10% APY for CATA rewards

    event StakeCreated(address indexed user, address escrow, uint assetAmount, decimal stratsLoan, uint cataReward);

    constructor(address _assetOracle, address _cataToken) {
        oracle = OracleService(_assetOracle);
        cataToken = _cataToken;
        owner = msg.sender;
    }

    function createEscrow(uint _assetAmount, address _assetAddress, PaymentServiceInfo _stratPaymentService) public returns (address) {

        // Calculate required values
        Asset _assetToBeSold = Asset(_assetAddress);
        uint _quantity = _assetToBeSold.quantity();
        (decimal _assetPrice, uint _priceTimestamp) = oracle.getLatestPrice();
        decimal _price = _assetPrice;
        decimal stratsLoanAmount = (decimal(_assetAmount) * _assetPrice * decimal(loanToValueRatio)) / 100;
        decimal cataReward = calculateCATAReward(_assetAmount, stratsLoanAmount);

        // Create the Escrow contract but do not attach assets or transfer STRATS
        Escrow escrow = new Escrow(msg.sender, uint(stratsLoanAmount), cataReward, address(this), address(stratsToken), _assetToBeSold, _price, _quantity, [_stratPaymentService]);

        stakeAsset(address(escrow));

        return address(escrow);
    }

    function stakeAsset(address _escrowAddress) internal {

        // Retrieve escrow details
        Escrow escrow = Escrow(_escrowAddress);
        decimal stratsLoanAmount = escrow.stratsLoanAmount();
        uint transferNumber = (uint(block.number + 16)) % 1000000;
        
        // Transfer STRATS from owner (BlockApps) to the borrower
        stratsToken.transferOwnership(escrow.borrower(), stratsLoanAmount*100, false, transferNumber, 0.0001);

        // Emit the StakeCreated event
        emit StakeCreated(msg.sender, _escrowAddress, escrow.quantity(), stratsLoanAmount, escrow.cataReward());
    }
    
    function calculateCATAReward(uint _assetAmount, decimal _stratsLoanAmount) internal view returns (decimal) {
        // Calculate reward based on 10% APY over a specific period
        // Placeholder calculation, assuming a yearly rate
        return (decimal(_assetAmount) * _stratsLoanAmount * decimal(cataAPYRate)) / 100;
    }

    //FUNCTION to get calculation of strats, rewards before they click the stake button
    function previewStake(decimal _assetAmount, address _assetAddress) public view returns (uint _stratsLoanAmount, decimal _cataReward) {
        (decimal _assetPrice, uint _priceTimestamp) = oracle.getLatestPrice();
        _stratsLoanAmount = uint((_assetAmount * _assetPrice * decimal(loanToValueRatio)) / 100);  // Calculate the STRATS loan amount
        _cataReward = calculateCATAReward(_assetAmount, _stratsLoanAmount);  // Calculate the CATA reward based on APY rate
        return (_stratsLoanAmount, _cataReward);
    }

    function getStratsToken() public view returns (Asset) {
        return stratsToken;
    }

    function setStratsToken(address _newStratsToken) public {
        require(msg.sender == owner, "Only owner can update STRATS token");
        stratsToken = Asset(_newStratsToken);
    }

    function transferSTRATSbacktoOwner(uint _amount) public {
        require(msg.sender == owner, "Only owner can transfer STRATS back");
        stratsToken.transferOwnership(owner, _amount, false, 0, 0);
    }

}
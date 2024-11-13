pragma es6;
pragma strict;

import <509>;

import "../Assets/Asset.sol";
import "./Escrow.sol";
import "../Utils/Utils.sol";
import "../Oracle/OracleService.sol";

abstract contract Reserve is Utils {
    OracleService public oracle; // Asset Oracle service for fetching price data
    Asset public stratsToken;
    address public cataToken;//Manual for now
    address public owner; // Owner (BlockApps) as source of STRATS tokens

    uint public loanToValueRatio = 50; // LTV ratio as percentage
    uint public cataAPYRate = 10; // 10% APY for CATA rewards

    event StakeCreated(address indexed user, address escrow, uint assetAmount, decimal stratsLoan, uint cataReward);

    constructor(address _assetOracle, address _cataToken, address _owner) {
        oracle = OracleService(_assetOracle);
        cataToken = _cataToken;
        owner = _owner;
    }

    function createEscrow(uint assetAmount, address assetAddress, PaymentService stratPaymentService) public returns (address) {

        // Calculate required values
        Asset _assetToBeSold = Asset(assetAddress);
        uint _quantity = _assetToBeSold.quantity();
        (decimal _assetPrice, uint _priceTimestamp) = oracle.getLatestPrice();
        decimal _price = _assetPrice * decimal(_assetToBeSold.quantity());
        decimal stratsLoanAmount = (decimal(assetAmount) * _assetPrice * decimal(loanToValueRatio)) / 100;
        uint cataReward = calculateCATAReward(assetAmount);

        // Create the Escrow contract but and attach asset
        Escrow escrow = new Escrow(msg.sender, uint(stratsLoanAmount), cataReward, address(this), address(stratsToken), _assetToBeSold, _price, _quantity, [stratPaymentService]);

        stakeAsset(address(escrow));

        return address(escrow);
    }

    function stakeAsset(address escrowAddress) internal {

        // Retrieve escrow details
        Escrow escrow = Escrow(escrowAddress);
        uint stratsLoanAmount = escrow.stratsLoanAmount();
        uint transferNumber = (uint(block.number + 16)) % 1000000;
        
        // Transfer STRATS from owner (BlockApps) to the borrower
        stratsToken.transferOwnership(escrow.borrower(), stratsLoanAmount*100, false, transferNumber, stratsLoanAmount);

        // Attach the escrow to both the Asset and STRATS assets
        // escrow.attachEscrowToAsset(escrow.assetToBeSold());
        // escrow.attachEscrowToAsset(Asset(stratsToken));//needs to be done off chain

        // Emit the StakeCreated event
        emit StakeCreated(msg.sender, escrowAddress, escrow.quantity(), stratsLoanAmount, escrow.cataReward());
    }
    
    function calculateCATAReward(uint assetAmount) internal view returns (uint) {
        // Calculate reward based on 10% APY over a specific period
        // Placeholder calculation, assuming a yearly rate
        return (assetAmount * cataAPYRate) / 100;
    }

    //FUNCTION to get calculation of strats, rewards before they click the stake button
    function previewStake(uint assetAmount, address assetAddress) public view returns (decimal stratsLoanAmount, uint cataReward) {
        (decimal _assetPrice, uint _priceTimestamp) = oracle.getLatestPrice();
        decimal stratsLoanAmount = (decimal(assetAmount) * _assetPrice * decimal(loanToValueRatio)) / 100;  // Calculate the STRATS loan amount
        cataReward = calculateCATAReward(assetAmount);  // Calculate the CATA reward based on APY rate

        return (uint(stratsLoanAmount), cataReward);
    }

    function getStratsToken() public view returns (Asset) {
        return stratsToken;
    }

    function setStratsToken(address _newStratsToken) public {
        require(msg.sender == owner, "Only owner can update STRATS token");
        stratsToken = Asset(_newStratsToken);
    }
}

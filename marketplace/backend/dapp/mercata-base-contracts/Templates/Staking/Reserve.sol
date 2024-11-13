
pragma es6;
pragma strict;

import <509>;
import "../Assets/Asset.sol";
import "../Items/STRATS.sol";
import "./Escrow.sol";
import "../Utils/Utils.sol";
import "../Oracle/OracleService.sol";

abstract contract Reserve is Utils {
    OracleService public oracle; // Asset Oracle service for fetching price data
    STRATSTokens public stratsToken;
    address public cataToken;//Manual for now
    address public owner; // Owner (BlockApps) as source of STRATS tokens

    uint public loanToValueRatio = 50; // LTV ratio as percentage
    uint public cataAPYRate = 10; // 10% APY for CATA rewards

    event StakeCreated(address indexed user, address escrow, uint assetAmount, uint stratsLoan, uint cataReward);
    event UnstakeProcessed(address indexed user, address escrow, uint assetAmount, uint repayment);

    constructor(address _assetOracle, address _stratsToken, address _cataToken, address _owner) {
        oracle = OracleService(_assetOracle);
        stratsToken = STRATSTokens(_stratsToken);
        cataToken = _cataToken;
        owner = _owner;
    }

    function createEscrow(uint assetAmount, address assetAddress) public returns (address) {

        // Calculate required values
        uint assetPrice = oracle.getLatestPrice();
        uint stratsLoanAmount = (assetAmount * assetPrice * loanToValueRatio) / 100;
        uint cataReward = calculateCATAReward(assetAmount);

        // Create the Escrow contract but do not attach assets or transfer STRATS
        Escrow escrow = new Escrow(msg.sender, assetAmount, assetAddress, stratsLoanAmount, cataReward, address(this));

        stakeAsset(address(escrow));

        return address(escrow);
    }

    function stakeAsset(address escrowAddress) internal {

        // Retrieve escrow details
        Escrow escrow = Escrow(escrowAddress);
        uint stratsLoanAmount = escrow.getLoanAmount();

        // Transfer STRATS from owner (BlockApps) to the borrower
        stratsToken.transfer(owner, stratsLoanAmount);

        // Attach the escrow to both the Asset and STRATS assets
        escrow.attachEscrowToAsset(escrow.getAssetAddress());
        escrow.attachEscrowToAsset(address(stratsToken));

        // Emit the StakeCreated event
        emit StakeCreated(msg.sender, escrowAddress, escrow.getAssetAmount(), stratsLoanAmount, escrow.getCataReward());
    }
    
    function calculateCATAReward(uint assetAmount) internal view returns (uint) {
        // Calculate reward based on 10% APY over a specific period
        // Placeholder calculation, assuming a yearly rate
        return (assetAmount * cataAPYRate) / 100;
    }

    //FUNCTION to get calculation of strats, rewards before they click the stake button
    function previewStake(uint assetAmount, address assetAddress) public view returns (uint stratsLoanAmount, uint cataReward) {
        uint assetPrice = oracle.getLatestPrice();  // Get the latest price from the oracle
        stratsLoanAmount = (assetAmount * assetPrice * loanToValueRatio) / 100;  // Calculate the STRATS loan amount
        cataReward = calculateCATAReward(assetAmount);  // Calculate the CATA reward based on APY rate

        return (stratsLoanAmount, cataReward);
    }

    // function sendCataRewards(){

    // }
}

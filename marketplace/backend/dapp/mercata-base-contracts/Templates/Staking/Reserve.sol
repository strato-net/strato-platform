pragma solidity ^0.8.0;

import "../Assets/Asset.sol";
import "../Items/STRATS.sol";
import "./Escrow.sol";
import "../Utils/Utils.sol";

contract Reserve is Utils {
    OracleService public oracle; // Asset Oracle service for fetching price data
    STRATSTokens public stratsToken;
    address public cataToken;
    address public owner; // Owner (BlockApps) as source of STRATS tokens

    uint public loanToValueRatio = 50; // LTV ratio as percentage
    uint public cataAPYRate = 10; // 10% APY for CATA rewards
    mapping(address => address) public assetEscrows;

    event StakeCreated(address indexed user, address escrow, uint assetAmount, uint stratsLoan, uint cataReward);
    event UnstakeProcessed(address indexed user, address escrow, uint assetAmount, uint repayment);

    constructor(address _assetOracle, address _stratsToken, address _cataToken, address _owner) {
        oracle = OracleService(_assetOracle);
        stratsToken = STRATSTokens(_stratsToken);
        cataToken = _cataToken;
        owner = _owner;
    }

    function createEscrow(uint assetAmount, address assetAddress) public returns (address) {
        require(assetEscrows[assetAddress] == address(0), "Escrow already exists for this asset");

        uint assetPrice = oracle.getLatestPrice();
        uint stratsLoanAmount = (assetAmount * assetPrice * loanToValueRatio) / 100;
        uint cataReward = calculateCATAReward(assetAmount);

        // Transfer STRATS from owner (BlockApps) to the borrower
        stratsToken.transfer(owner, stratsLoanAmount);

        // Create new Escrow contract
        Escrow escrow = new Escrow(msg.sender, assetAmount, assetAddress, stratsLoanAmount, cataReward, address(this));
        assetEscrows[assetAddress] = address(escrow);

        // Attach the escrow to both the Asset and STRATS assets
        escrow.attachEscrowToAsset(assetAddress);
        escrow.attachEscrowToAsset(address(stratsToken));

        emit StakeCreated(msg.sender, address(escrow), assetAmount, stratsLoanAmount, cataReward);

        return address(escrow);
    }

    function calculateCATAReward(uint assetAmount) internal view returns (uint) {
        // Calculate reward based on 10% APY over a specific period
        // Placeholder calculation, assuming a yearly rate
        return (assetAmount * cataAPYRate) / 100;
    }

    function processUnstake(uint repayment, address escrow) external {
        require(assetEscrows[escrow] != address(0), "Unauthorized Unstake request");
        
        Escrow escrowContract = Escrow(escrow);
        require(escrowContract.getLoanAmount() == repayment, "Repayment amount mismatch");

        // Transfer STRATS back to owner
        stratsToken.transfer(owner, repayment);

        // Release the collateral back to the borrower
        escrowContract.releaseCollateral(msg.sender);

        emit UnstakeProcessed(msg.sender, escrow, escrowContract.getAssetAmount(), repayment);
    }
}

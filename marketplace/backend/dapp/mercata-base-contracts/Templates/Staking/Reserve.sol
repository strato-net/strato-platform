pragma solidity ^0.8.0;

import "../Assets/Asset.sol";
import "../Items/STRATS.sol";
import "./Escrow.sol";
// import "./Oracle.sol";
import "../Utils/Utils.sol";

contract Reserve is Utils {
    OracleService public oracle;// Using asset oracle service here
    STRATSTokens public stratsToken;
    address public cataToken;

    uint public loanToValueRatio = 50; // LTV ratio as percentage
    uint public cataAPYRate = 10; // 10% APY for CATA rewards
    mapping(address => address) public assetEscrows;

    event StakeCreated(address indexed user, address escrow, uint assetAmount, uint stratsLoan, uint cataReward);
    event UnstakeProcessed(address indexed user, address escrow, uint assetAmount, uint repayment);

    constructor(address _assetOracle, address _stratsToken, address _cataToken) {
        assetOracle = Oracle(_assetOracle);
        stratsToken = STRATSTokens(_stratsToken);
        cataToken = _cataToken;
    }

    function createEscrow(uint assetAmount, address assetAsset) public returns (address) {
        require(assetEscrows[assetAsset] == address(0), "Escrow already exists for this asset");

        uint assetPrice = oracle.getLatestPrice();
        uint stratsLoanAmount = (assetAmount * assetPrice * loanToValueRatio) / 100;
        uint cataReward = calculateCATAReward(assetAmount);

        // Transfer STRATS to the borrower
        stratsToken.purchaseTransfer(msg.sender, stratsLoanAmount, 0, 0);

        // Create new Escrow contract
        Escrow escrow = new Escrow(msg.sender, assetAmount, assetAsset, stratsLoanAmount, cataReward, address(this));
        assetEscrows[assetAsset] = address(escrow);

        // Attach the escrow to the Asset and STRATS assets
        escrow.attachEscrowToAsset(assetAsset);
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
        Escrow(escrow).releaseCollateral(msg.sender);
        
        emit UnstakeProcessed(msg.sender, escrow, Escrow(escrow).getAssetAmount(), repayment);
    }
}

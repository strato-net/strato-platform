pragma solidity ^0.8.0;

import "../Assets/Asset.sol";
import "../Items/STRATS.sol";
import "./Escrow.sol";
// import "./Oracle.sol";
import "../Utils/Utils.sol";

contract Reserve is Utils {
    Oracle public silverOracle;
    STRATSTokens public stratsToken;
    address public cataToken;

    uint public loanToValueRatio = 50; // LTV ratio as percentage
    uint public cataAPYRate = 10; // 10% APY for CATA rewards
    mapping(address => address) public assetEscrows;

    event StakeCreated(address indexed user, address escrow, uint silverAmount, uint stratsLoan, uint cataReward);
    event UnstakeProcessed(address indexed user, address escrow, uint silverAmount, uint repayment);

    constructor(address _silverOracle, address _stratsToken, address _cataToken) {
        silverOracle = Oracle(_silverOracle);
        stratsToken = STRATSTokens(_stratsToken);
        cataToken = _cataToken;
    }

    function createEscrow(uint silverAmount, address silverAsset) public returns (address) {
        require(assetEscrows[silverAsset] == address(0), "Escrow already exists for this asset");

        uint silverPrice = silverOracle.getSilverPrice();
        uint stratsLoanAmount = (silverAmount * silverPrice * loanToValueRatio) / 100;
        uint cataReward = calculateCATAReward(silverAmount);

        // Transfer STRATS to the borrower
        stratsToken.purchaseTransfer(msg.sender, stratsLoanAmount, 0, 0);

        // Create new Escrow contract
        Escrow escrow = new Escrow(msg.sender, silverAmount, silverAsset, stratsLoanAmount, cataReward, address(this));
        assetEscrows[silverAsset] = address(escrow);

        // Attach the escrow to the Silver and STRATS assets
        escrow.attachEscrowToAsset(silverAsset);
        escrow.attachEscrowToAsset(address(stratsToken));

        emit StakeCreated(msg.sender, address(escrow), silverAmount, stratsLoanAmount, cataReward);

        return address(escrow);
    }

    function calculateCATAReward(uint silverAmount) internal view returns (uint) {
        // Calculate reward based on 10% APY over a specific period
        // Placeholder calculation, assuming a yearly rate
        return (silverAmount * cataAPYRate) / 100;
    }

    function processUnstake(uint repayment, address escrow) external {
        require(assetEscrows[escrow] != address(0), "Unauthorized Unstake request");
        Escrow(escrow).releaseCollateral(msg.sender);
        
        emit UnstakeProcessed(msg.sender, escrow, Escrow(escrow).getSilverAmount(), repayment);
    }
}

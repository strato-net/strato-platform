pragma solidity ^0.8.0;

import "../Assets/Asset.sol";
import "../Sales/Sale.sol";
import "../Utils/Utils.sol";

contract Escrow is Sale {
    address public reserve;
    address public borrower;
    uint public totalSilverAmount;  // Represents the total amount of staked assets
    uint public stratsLoanAmount;
    uint public cataReward;
    uint public cataWeeklyReward;

    event CollateralReleased(address indexed borrower, uint totalSilverAmount);

    modifier onlyReserve() {
        require(msg.sender == reserve, "Only the Reserve contract can call this");
        _;
    }

    constructor(
        address _borrower,
        uint _totalSilverAmount,
        address[] memory _silverAssets,
        uint _stratsLoanAmount,
        uint _cataReward,
        address _reserve
    ) Sale(_silverAssets, 0, _totalSilverAmount, new PaymentService[]()) {
        borrower = _borrower;
        totalSilverAmount = _totalSilverAmount;
        stratsLoanAmount = _stratsLoanAmount;
        cataReward = _cataReward;
        cataWeeklyReward = (cataReward * 10) / 52;  // Assuming the CATA reward rate is provided externally
        reserve = _reserve;

        // Attach this Escrow contract as the sale for each asset in the assetsToBeSold array
        for (uint i = 0; i < _silverAssets.length; i++) {
            Asset(_silverAssets[i]).attachSale();
        }
    }

    function getAssetAmount() public view returns (uint) {
        return totalSilverAmount;
    }

    function getLoanAmount() public view returns (uint) {
        return stratsLoanAmount;
    }

    function releaseCollateral(address requester) external onlyReserve {
        for (uint i = 0; i < assetsToBeSold.length; i++) {
            uint assetQuantity = assetsToBeSold[i].quantity();
            Asset(assetsToBeSold[i]).transferOwnership(requester, assetQuantity, false, 0, 0);
        }
        emit CollateralReleased(requester, totalSilverAmount);
    }

    function attachEscrowToAsset(address asset) public onlyReserve {
        // Attach the Escrow contract to the specified asset
        Asset(asset).attachSale();
    }

    function detachEscrowFromAssets() external onlyReserve {
        // Detach this Escrow contract from all assets upon loan repayment
        for (uint i = 0; i < assetsToBeSold.length; i++) {
            Asset(assetsToBeSold[i]).closeSale();
        }
    }
}

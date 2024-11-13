pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract Escrow is Sale {
    address public reserve;
    address public borrower;
    uint public totalSilverAmount;  // Represents the total amount of staked assets
    uint public stratsLoanAmount;
    uint public cataReward;
    uint public cataWeeklyReward;
    address public stratsAddress;

    event CollateralReleased(address indexed borrower, uint totalSilverAmount);

    modifier onlyReserve() {
        require(msg.sender == reserve, "Only the Reserve contract can call this");
        _;
    }

    constructor(
        address _borrower,
        uint _totalSilverAmount,
        address[] _Assets,
        uint _stratsLoanAmount,
        uint _cataReward,
        address _reserve,
        address _stratsAddress
    ) Sale(_Assets, 0, _totalSilverAmount, new PaymentService[]()) {
        borrower = _borrower;
        totalSilverAmount = _totalSilverAmount;
        stratsLoanAmount = _stratsLoanAmount;
        cataReward = _cataReward;
        cataWeeklyReward = (cataReward * 10) / 52;  // Assuming the CATA reward rate is provided externally
        reserve = _reserve;

        // Attach this Escrow contract as the sale for each asset in the assetsToBeSold array
        for (uint i = 0; i < _Assets.length; i++) {
            Asset(_Assets[i]).attachSale();
        }
    }

    function getAssetAmount() public returns (uint) {
        return totalSilverAmount;
    }

    function getLoanAmount() public returns (uint) {
        return stratsLoanAmount;
    }

    function attachEscrowToAsset(address asset) public onlyReserve {
        // Attach the Escrow contract to the specified asset
        Asset(asset).attachSale();
    }

    // function detachEscrowFromAssets() external requirePaymentService {
    //     // Detach this Escrow contract from all assets upon loan repayment
    //     for (uint i = 0; i < assetsToBeSold.length; i++) {
    //         Asset(assetsToBeSold[i]).closeSale();
    //     }
    // }

    function closeSale() external override requirePaymentService("complete sale") returns (uint) {
        _closeSale();
    }
}

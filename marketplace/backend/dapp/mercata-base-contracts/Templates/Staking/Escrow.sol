pragma es6;
pragma strict;

import "../Sales/Sale.sol";
import "../Assets/Asset.sol";

contract Escrow is Sale {
    address public reserve;
    address public borrower;
    uint public stratsLoanAmount;
    decimal public cataReward;
    decimal public cataWeeklyReward;
    address public stratsAddress;

    event CollateralReleased(address indexed borrower, uint totalSilverAmount);

    modifier onlyReserve() {
        require(msg.sender == reserve, "Only the Reserve contract can call this");
        _;
    }

    constructor(
        address _borrower,
        uint _stratsLoanAmount,
        decimal _cataReward,
        address _reserve,
        address _stratsAddress,
        Asset _assetToBeSold,
        decimal _price,
        uint _quantity,
        PaymentService[] _paymentServices
    ) Sale(_assetToBeSold, _price, _quantity, _paymentServices) {
        borrower = _borrower;
        stratsLoanAmount = _stratsLoanAmount;
        cataReward = _cataReward;
        cataWeeklyReward = (cataReward * 10) / 52;  // Assuming the CATA reward rate is provided externally
        reserve = _reserve;
    }

    function attachEscrowToAsset(Asset _asset) public onlyReserve {
        // Attach the Escrow contract to the specified asset
        asset.attachSale();
    }

    function closeSale() external override requirePaymentService("complete sale") returns (uint) {
        _closeSale();
    }
}

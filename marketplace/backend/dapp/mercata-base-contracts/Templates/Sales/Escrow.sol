pragma es6;
pragma strict;

contract Escrow is Sale {
    address public reserve;
    address public borrower;
    uint public stratsLoanAmount;
    decimal public cataReward;
    decimal public cataWeeklyReward;

    constructor(
        address _borrower,
        uint _stratsLoanAmount,
        decimal _cataReward,
        Asset _assetToBeSold,
        decimal _price,
        uint _quantity,
        PaymentServiceInfo[] _paymentServices
    ) Sale(_assetToBeSold, _price, _quantity, _paymentServices) {
        borrower = _borrower;
        stratsLoanAmount = _stratsLoanAmount;
        cataReward = _cataReward;
        cataWeeklyReward = (cataReward * 10) / 52;  // Assuming the CATA reward rate is provided externally
        reserve = msg.sender;
    }

    function closeSale() external override requirePaymentService("complete sale") returns (uint) {
        _closeSale();
    }
}

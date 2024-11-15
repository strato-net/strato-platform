pragma es6;
pragma strict;

contract Escrow is Sale {
    address public reserve; //Can be used to distinguish between Sale and Escrow
    address public borrower;
    uint public stratsLoanAmount;
    decimal public cataRewardInDollars;
    decimal public escrowPrice;

    constructor(
        address _borrower,
        uint _stratsLoanAmount,
        decimal _cataRewardInDollars,
        Asset _assetToBeSold,
        decimal _escrowPrice,
        uint _escrowQuantity,
        PaymentServiceInfo[] _paymentServices
    ) Sale(_assetToBeSold, 0, _escrowQuantity, _paymentServices) {
        escrowPrice = _escrowPrice;
        borrower = _borrower;
        stratsLoanAmount = _stratsLoanAmount;
        cataRewardInDollars = _cataRewardInDollars; // Assuming the CATA reward rate is provided externally
        reserve = msg.sender;
    }

    function closeSale() external override requirePaymentService("complete sale") returns (uint) {
        _closeSale();
    }
}

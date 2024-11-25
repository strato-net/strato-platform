pragma es6;
pragma strict;

contract Escrow is Sale {
    address public reserve; //Can be used to distinguish between Sale and Escrow
    address public borrower;
    decimal public stratsLoanAmount;
    decimal public cataRewardInDollars;
    decimal public escrowPrice;
    decimal public borrowedAmount;

    constructor(
        address _borrower,
        uint _stratsLoanAmount,
        decimal _cataRewardInDollars,
        address _assetToBeSold,
        decimal _escrowPrice,
        uint _escrowQuantity,
        PaymentServiceInfo[] _paymentServices
    ) Sale("Escrow", _assetToBeSold, 0, _escrowQuantity, _paymentServices) {
        escrowPrice = _escrowPrice;
        borrower = _borrower;
        stratsLoanAmount = _stratsLoanAmount;
        cataRewardInDollars = _cataRewardInDollars; // Assuming the CATA reward rate is provided externally
        reserve = msg.sender;
    }

    function closeSale() external override returns (uint) {
        require(msg.sender == reserve, "Only reserve can close Escrow");
        _closeSale();
    }

    function updateBorrowedAmount(decimal _borrowAmount) external {
        require(msg.sender == reserve, "Only reserve can update borrowed amount");
        require(_borrowAmount >= 0.0, "Borrowed amount cannot be negative");
        require(borrowedAmount + _borrowAmount <= stratsLoanAmount, "Cannot borrow more than loan amount");
        borrowedAmount += _borrowAmount;
    }

    function clearLoan() external requirePaymentService ("clear loan") {
        borrowedAmount = 0.0;
    }

}

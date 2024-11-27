pragma es6;
pragma strict;

contract Escrow is Sale {
    address public reserve; //Can be used to distinguish between Sale and Escrow
    address public borrower;
    decimal public collateralAmount;
    uint public maxStratsLoanAmount;
    decimal public totalCataRewardInDollars;
    decimal public oraclePrice;
    decimal public borrowedAmount;

    constructor(
        address _borrower,
        decimal _collateralAmount,
        uint _maxStratsLoanAmount,
        address _assetToBeSold,
        decimal _oraclePrice,
        uint _escrowQuantity,
        PaymentServiceInfo[] _paymentServices
    ) Sale("Escrow", _assetToBeSold, 0, _escrowQuantity, _paymentServices) {
        collateralAmount = _collateralAmount;
        oraclePrice = _oraclePrice;
        borrower = _borrower;
        maxStratsLoanAmount = _maxStratsLoanAmount;
        totalCataRewardInDollars = 0.0; // Assuming the CATA reward rate is provided externally
        reserve = msg.sender;
    }

    function closeSale() external override returns (uint) {
        require(msg.sender == reserve, "Only reserve can close Escrow");
        _closeSale();
    }

    function updateBorrowedAmount(decimal _borrowAmount) external {
        require(msg.sender == reserve, "Only reserve can update borrowed amount");
        require(_borrowAmount >= 0.0, "Borrowed amount cannot be negative");
        require(uint(borrowedAmount + _borrowAmount) <= maxStratsLoanAmount, "Cannot borrow more than loan amount");
        borrowedAmount += _borrowAmount;
    }

    function clearLoan() external requirePaymentService ("clear loan") {
        borrowedAmount = 0.0;
    }

    function updateOnPriceChange(decimal _newPrice, decimal _loanToValueRatio) external {
        require(msg.sender == reserve, "Only reserve can update collateral price");

        collateralAmount = collateralAmount * _newPrice.truncate(2);

        maxStratsLoanAmount = uint(collateralAmount * _loanToValueRatio / 100);
    }

    function updateTotalCataReward(decimal _newCataReward) external {
        require(msg.sender == reserve, "Only reserve can update CATA reward");
        totalCataRewardInDollars += _newCataReward;
    }


}

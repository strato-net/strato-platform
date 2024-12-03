pragma es6;
pragma strict;

contract Escrow is Sale {
    address public reserve; //Can be used to distinguish between Sale and Escrow
    address public borrower;
    uint public collateralQuantity;
    decimal public collateralValue;
    uint public maxStratsLoanAmount;
    decimal public totalCataRewardInDollars;
    decimal public borrowedAmount;
    uint public lastRewardTimestamp;

    constructor(
        address _borrower,
        uint _collateralQuantity,
        decimal _collateralValue,
        uint _maxStratsLoanAmount,
        address _assetToBeSold,
        PaymentServiceInfo[] _paymentServices
    ) Sale("Escrow", _assetToBeSold, 0, _collateralQuantity, _paymentServices) {
        collateralQuantity = _collateralQuantity;
        collateralValue = _collateralValue;
        borrower = _borrower;
        maxStratsLoanAmount = _maxStratsLoanAmount;
        totalCataRewardInDollars = 0.0; // Assuming the CATA reward rate is provided externally
        lastRewardTimestamp = block.timestamp;
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

    function updateOnPriceChange(decimal _newPrice, uint _loanToValueRatio) external {
        require(msg.sender == reserve, "Only reserve can update collateral price");

        collateralValue = collateralQuantity * _newPrice.truncate(2);

        maxStratsLoanAmount = uint(collateralValue * decimal(_loanToValueRatio));

        lastRewardTimestamp = block.timestamp;
    }

    function updateTotalCataReward(decimal _newCataReward) external {
        require(msg.sender == reserve, "Only reserve can update CATA reward");
        totalCataRewardInDollars += _newCataReward;
    }

    function updateReserve(address _newReserve) external {
        require(msg.sender == reserve, "Only the existing reserve can update the reserve address");
        reserve = _newReserve;
    }

}

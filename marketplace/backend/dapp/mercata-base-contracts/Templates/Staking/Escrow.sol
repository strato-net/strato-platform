pragma es6;
pragma strict;
import <BASE_CODE_COLLECTION>;

/// @title A representation of asset escrow contract
contract Escrow is Sale {
    address public governance;
    address public borrower;

    constructor(
        address _assetToBeSold,
        decimal _price,
        uint _quantity,
        PaymentService[] _paymentServices,
        address[] _stratsAssetAddresses,
    ) Sale(_assetToBeSold, _price, _quantity, _paymentServices) {
        Asset assetToBeSold = Asset(_assetToBeSold)
        borrower = assetToBeSold.owner();

        governance = msg.sender;
    }

    function unstake(address _borrower) external requirePaymentService("complete sale") returns (uint) {
        require(_borrower == borrower, "Condition not met");
        assetToBeSold.transferOwnership(borrower, _quantity, false, 0, 0);
        closeSaleIfEmpty();
        return RestStatus.OK;
    }
}

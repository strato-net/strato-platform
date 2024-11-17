pragma es6;
pragma strict;
import <BASE_CODE_COLLECTION>;

/// @title A representation of asset sale contract
contract SimpleSale is Sale {
    constructor(
        address _assetToBeSold,
        decimal _price,
        uint _quantity,
        PaymentServiceInfo[] _paymentServices
    ) Sale(_assetToBeSold, _price, _quantity, _paymentServices) {}

    function addPaymentServices(PaymentServiceInfo[] _paymentServices) external requireSeller("add payment services") {
        _addPaymentServices(_paymentServices);
    }

    function clearPaymentServices() external requireSeller("add payment services") {
        _clearPaymentServices();
    }

    function closeSale() external override requireSeller("close sale") returns (uint) {
        return _closeSale();
    }

    function cancelOrder(
        string orderHash,
        address purchaser
    ) public requireSellerOrPaymentService("cancel order") returns (uint) {
        return _cancelOrder(orderHash, purchaser);
    }

    function update(
        uint _quantity,
        decimal _price,
        PaymentServiceInfo[] _paymentServices,
        uint _scheme
    ) external requireSeller("Update Sale") returns (uint) {
        return _update(_quantity, _price, _paymentServices, _scheme);
    }

    function completeSale(
        string orderHash,
        address purchaser
    ) public override requirePaymentService("complete sale") returns (uint) {
        uint orderQuantity = takeLockedQuantity(orderHash, purchaser);
        // regular transfer - isUserTransfer: false, transferNumber: 0, transferPrice: 0
        try {
            assetToBeSold.transferOwnership(purchaser, orderQuantity, false, 0, 0);
        } catch { // Backwards compatibility for old assets
            address(assetToBeSold).call("transferOwnership", purchaser, orderQuantity, false, 0);
        }
        closeSaleIfEmpty();
        return RestStatus.OK;
    }

    function automaticTransfer(address _newOwner, decimal _price, uint _quantity, uint _transferNumber) public override returns (uint) {
        require(msg.sender == address(assetToBeSold), "Only the underlying Asset can call automaticTransfer.");
        require(_quantity > 0, "Quantity must be greater than 0");
        uint assetQuantity = assetToBeSold.quantity();
        require(_quantity <= assetQuantity - totalLockedQuantity, "Cannot transfer more units than are available.");
        if (_quantity > quantity) { // We can transfer more than the Sale quantity
            quantity = 0;
        } else {
            quantity -= _quantity;
        }
        // transfer feature - isUserTransfer: true, transferNumber: _transferNumber, transferPrice: _price
        try {
            assetToBeSold.transferOwnership(_newOwner, _quantity, true, _transferNumber, _price);
        } catch { // Backwards compatibility for old assets
            address(assetToBeSold).call("transferOwnership", _newOwner, _quantity, true, _transferNumber);
        }
        closeSaleIfEmpty();
        return RestStatus.OK;
    }
}

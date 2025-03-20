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
        require(_quantity + totalLockedQuantity <= assetToBeSold.balanceOf(msg.sender), "Cannot sell more units than owned");
        assetToBeSold.transferOwnership(msg.sender, _quantity, false, 0, 0);
        return _update(_price, _paymentServices, _scheme);
    }

    function completeSale(
        string orderHash,
        address purchaser
    ) public override requirePaymentService("complete sale") returns (uint) {
        uint orderQuantity = takeLockedQuantity(orderHash, purchaser);
        // regular transfer - isUserTransfer: false, transferPrice: 0
        assetToBeSold.transferOwnership(purchaser, orderQuantity, false, 0);
        closeSaleIfEmpty();
        return RestStatus.OK;
    }

    function automaticTransfer(address _newOwner, decimal _price, uint _quantity) public override returns (uint) {
        require(msg.sender == address(assetToBeSold), "Only the underlying Asset can call automaticTransfer.");
        require(_quantity > 0, "Quantity must be greater than 0");
        uint assetQuantityInSale = getQuantity();
        require(_quantity <= assetQuantityInSale - totalLockedQuantity, "Cannot transfer more units than are available.");
        assetToBeSold.transferOwnership(_newOwner, _quantity, true, _price);
        closeSaleIfEmpty();
        return RestStatus.OK;
    }
}

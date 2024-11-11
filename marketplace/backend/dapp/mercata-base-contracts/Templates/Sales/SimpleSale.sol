pragma es6;
pragma strict;
import <BASE_CODE_COLLECTION>;

/// @title A representation of asset sale contract
contract SimpleSale is Sale {
    constructor(
        address _assetToBeSold,
        decimal _price,
        uint _quantity,
        PaymentService[] _paymentServices
    ) Sale(_assetToBeSold, _price, _quantity, _paymentServices) {
    }

     modifier requireSeller(string action) {
        string sellersCommonName = assetsToBeSold[0].ownerCommonName();
        string err = "Only "
                   + sellersCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = getCommonName(msg.sender);
        require(commonName == sellersCommonName, err);
    }

    function changePrice(decimal _price) public requireSeller("change price"){
        price=_price;
    }

    function addPaymentServices(PaymentService[] _paymentServices) public requireSeller("add payment services") {
        _addPaymentServices(_paymentServices);
    }
    
    function clearPaymentServices() public requireSeller("clear payment services") {
        _clearPaymentServices();
    }

    function removePaymentServices(PaymentService[] _paymentServices) public requireSeller("remove payment services") {
        for (uint i = 0; i < _paymentServices.length; i++) {
            PaymentService p = _paymentServices[i];
            uint x = paymentServicesMap[p.serviceName][p.creator];
            if (x > 0) {
                paymentServices[x-1].creator = "";
                paymentServices[x-1].serviceName = "";
                paymentServicesMap[p.serviceName][p.creator] = 0;
            }
        }
    }

    function completeSale(
        string orderHash,
        address purchaser
    ) public override requirePaymentService("complete sale") returns (uint) {
        uint orderQuantity = takeLockedQuantity(orderHash, purchaser);
        // regular transfer - isUserTransfer: false, transferNumber: 0, transferPrice: 0
        try {
            assetsToBeSold[0].transferOwnership(purchaser, orderQuantity, false, 0, 0);
        } catch { // Backwards compatibility for old assets
            address(assetsToBeSold[0]).call("transferOwnership", purchaser, orderQuantity, false, 0);
        }
        closeSaleIfEmpty();
        return RestStatus.OK;
    }

    function automaticTransfer(
        address _newOwner,
        decimal _price,
        uint _quantity,
        uint _transferNumber
    ) public override returns (uint) {
        // Ensure the caller is one of the assets in assetsToBeSold
        bool isAuthorized = false;
        for (uint i = 0; i < assetsToBeSold.length; i++) {
            if (msg.sender == address(assetsToBeSold[i])) {
                isAuthorized = true;
                break;
            }
        }
        require(isAuthorized, "Only the underlying Assets can call automaticTransfer.");
        require(_quantity > 0, "Quantity must be greater than 0");

        uint totalAssetQuantity = getTotalAssetQuantity();
        require(_quantity <= totalAssetQuantity - totalLockedQuantity, "Cannot transfer more units than are available.");

        // Deduct quantity from the sale's available quantity
        if (_quantity > quantity) { 
            quantity = 0;
        } else {
            quantity -= _quantity;
        }

        uint remainingQuantity = _quantity;
        
        // Distribute the transfer across multiple assets in assetsToBeSold
        for (uint i = 0; i < assetsToBeSold.length && remainingQuantity > 0; i++) {
            uint assetQuantity = assetsToBeSold[i].quantity();
            uint transferQuantity = remainingQuantity > assetQuantity ? assetQuantity : remainingQuantity;
            remainingQuantity -= transferQuantity;

            // Perform the transfer
            try {
                assetsToBeSold[i].transferOwnership(_newOwner, transferQuantity, true, _transferNumber, _price);
            } catch { 
                address(assetsToBeSold[i]).call("transferOwnership", _newOwner, transferQuantity, true, _transferNumber);
            }
        }

        // Check if the sale should be closed after the transfer
        closeSaleIfEmpty();
        return RestStatus.OK;
    }

    function closeSale() public requireSeller("close sale") returns (uint) {
        close();
        isOpen = false; 
        return RestStatus.OK;
    }

    function cancelOrder(
        string orderHash,
        address purchaser
    ) public requireSellerOrPaymentService("cancel order") returns (uint) {
        unlockQuantity(orderHash, purchaser);
        return RestStatus.OK;
    }
}

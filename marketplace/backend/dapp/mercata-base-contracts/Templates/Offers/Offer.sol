pragma es6;
pragma strict;

import <509>;
import "../Assets/Asset.sol";
import "../Enums/RestStatus.sol";
import "../Sales/Sale.sol";

abstract contract Offer is Utils { 
    Asset public assetToBePurchased;
    Asset public assetToBeSold;
    address public sale;
    decimal public pricePerItem;
    decimal public totalPrice;
    uint public quantity;
    address public purchaser;
    string public purchaserCommonName;
    address public seller;
    PaymentService public paymentService;
    string public imageUrl;
    offerStatus public status;

    enum OfferStatus { PENDING, ACCEPTED, REJECTED, CANCELLED }

    constructor(
        address _assetToBePurchased,
        address _sale,
        decimal _pricePerItem,
        uint _quantity,
        address _purchaser,
        string _imageUrl
    ) {    
        assetToBePurchased = Asset(_assetToBePurchased);
        sale = _sale;
        // require(_assetToBePurchased == assetToBePurchased.root, "Can only open Offers on root assets");
        assetToBeSold = assetToBePurchased;
        priceperItem = _pricePerItem;
        quantity = _quantity;
        totalPrice = pricePerItem * decimal(quantity);
        purchaser = _purchaser;
        purchaserCommonName = getCommonName(purchaser);
        paymentService = PaymentService(msg.sender);
        imageUrl = _imageUrl;
        status = OfferStatus.PENDING;
    }

    modifier requirePurchaser(string action) {
        string err = "Only "
                   + purchaserCommonName
                   + " can perform "
                   + action
                   + ".";
        string commonName = getCommonName(msg.sender);
        require(commonName == purchaserCommonName, err);
    }

    modifier requireOwner() {
        string err = "Only the owner of the asset can perform this action.";
        require(msg.sender == seller, err);
    }

    function acceptOffer(uint _quantity, address[] _assets) requireOwner() public returns (uint, uint) {
        uint quantityToFill;
        uint quantityToReturn;
        if (_quantity <= quantity) {
            quantityToFill = _quantity;
        } else {
            quantityToFill = quantity;
            quantityToReturn = _quantity - quantity;
        }
        uint quantityRemaining = quantityToFill;
        for (uint i = 0; i < _assets.length; i++) {
            Asset a = Asset(_assets[i]);
            require(Asset(a.root) == assetToBeSold, "Cannot fill bid with different types of assets.");
            uint q = a.quantity();
            uint quantityForAsset;
            if (q <= quantityRemaining) {
                quantityForAsset = q;
            } else {
                quantityForAsset = quantityRemaining;
            }
            quantityRemaining -= quantityForAsset;
            // a.attachSale();
            assetToBeSold = a;
            paymentService.checkoutInitialized(
                keccak256(string(address(this)) + string(address(a)) + string(block.timestamp)),
                [address(this)],
                [quantityForAsset],
                block.timestamp,
                "Offer of quantity " + string(quantityForAsset) + "filled for asset " + string(address(a)) + " for $" + string(uint(totalPrice))
            );
            try {
                a.transferOwnership(purchaser, quantityForAsset, false, 0, totalPrice);
            } catch { // Backwards compatibility for old assets
                address(a).call("transferOwnership", purchaser, quantityForAsset, false, 0);
            }
            if (quantityRemaining == 0) {
                break;
            }
        }
        assetToBeSold = assetToBePurchased;
        uint quantityFilled = quantityToFill - quantityRemaining;
        quantity -= quantityFilled;
        closeSaleIfEmpty();
        return (quantityFilled, quantityToReturn + quantityRemaining);
    }


    function completeSale(
        string _orderHash,
        address _purchaser
    ) public returns (uint) {
        Sale s = Sale(sale);
        s.completeSale(_orderHash, _purchaser);
        closeSaleIfEmpty();
        return RestStatus.OK;

    }

    function closeSaleIfEmpty() internal {
        if (quantity == 0) {
            close();
        }
    }

    function close() internal {
        _close();
        quantity = 0;
        isOpen = false;
    }

    function _close() internal virtual {
    }

    function lockQuantity(
        uint _quantityToLock,
        string _orderHash,
        address _purchaser
    ) public {
    }

    function closeOffer() public requirePurchaser("close Offer") returns (uint) {
        close();
        return RestStatus.OK;
    }

    function update(
        uint _quantity,
        decimal _pricePerItem,
        uint _scheme
    ) public requirePurchaser("update the Offer") returns (uint) {

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        quantity = _quantity;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        pricePerItem = _pricePerItem;
      }
      return RestStatus.OK;
    }

    function rejectOffer() public requireOwner() returns (uint) {
        require(isOpen == true, "Cannot accept a non-pending offer.");
        closeOffer();
        isOpen = false;
        status = OfferStatus.REJECTED;
        return RestStatus.OK;
    }

    function cancelOffer() public requirePurchaser("cancel the Offer") returns (uint) {
        require(isOpen == true, "Cannot accept a non-pending offer.");
        closeOffer();
        isOpen = false;
        status = OfferStatus.CANCELLED;
        return RestStatus.OK;
    }
}
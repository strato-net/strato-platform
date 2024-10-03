pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;
import "../../../items/contracts/STRATS.sol";

abstract contract OfferTest is Utils { 
    Asset public assetToBePurchased;
    address public sale;
    string[] public stratAssetAddresses;
    decimal public offerPrice; // Offer Price per item.
    decimal public totalOfferPrice; // Total amount of the offer.
    uint public quantity;
    address public purchaser;
    string public purchaserCommonName;
    PaymentService public paymentService;
    string public imageUrl;
    string public assetName;
    OfferStatus public status;
    string public createdDate;
    string public updatedDate;

    enum OfferStatus { PENDING, ACCEPTED, REJECTED, CANCELLED }

    constructor(
        address _assetToBePurchased,
        address _sale,
        decimal _price,
        uint _quantity,
        address _purchaser
    ) {    
        assetToBePurchased = Asset(_assetToBePurchased);
        sale = _sale;
        offerPrice = _price;
        totalOfferPrice = _price * _quantity;
        quantity = _quantity;
        purchaser = _purchaser;
        purchaserCommonName = getCommonName(purchaser);
        paymentService = PaymentService(msg.sender);
        imageUrl = assetToBePurchased.images()[0];
        assetName = assetToBePurchased.name();
        status = OfferStatus.PENDING;
        createdDate = string(block.timestamp);
        updatedDate = string(0);
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
        Asset a = Asset(assetToBePurchased);
        address seller = a.owner();
        require(msg.sender == seller, err);
    }

    function accept(address _asset) requireOwner() public returns (uint) {
        require(status == OfferStatus.PENDING, "Cannot accept a non-pending offer.");
        Sale s = Sale(sale);
        uint quantityToFill = s.quantity();

        require(quantityToFill >= quantity, "Not enough quantity to fill the offer.");

        paymentService.checkoutInitialized(
            stratAssetAddresses,
            keccak256(string(this), string(_asset) + string(block.timestamp) + "checkoutHash"),
            keccak256(string(this), string(_asset) + string(block.timestamp) + "checkoutId"),
            purchaser,
            purchaserCommonName,
            [address(this)],
            [quantity],
            block.timestamp,
            "Offer accepted for asset " + string(_asset) + " of quantity " + string(quantity) + " for $" + string(uint(totalOfferPrice))
        );

        status = OfferStatus.ACCEPTED;
        updatedDate = string(block.timestamp);

        return (RestStatus.OK);
    }

    function completeSale(
        string _orderHash,
        address _purchaser
    ) public returns (uint) {
        Sale s = Sale(sale);
        s.completeSale(_orderHash, _purchaser);
        return RestStatus.OK;

    }

    function lockQuantity(
        uint _quantityToLock,
        string _orderHash,
        address _purchaser
    ) public {
        Sale s = Sale(sale);
        s.lockQuantity(_quantityToLock, _orderHash, _purchaser);
    }
    // Needed for old assets
    function lockQuantity(
        uint _quantityToLock,
        address _purchaser
    ) public {
        Sale s = Sale(sale);
        s.lockQuantity(_quantityToLock, _purchaser);
    }
    // Needed for old assets
    function lockQuantity(
        uint _quantityToLock
    ) public {
        Sale s = Sale(sale);
        s.lockQuantity(_quantityToLock);
    }

    // Update offer status and transfer strats back to the purchaser
    function reject() public requireOwner() returns (uint) {
        require(status == OfferStatus.PENDING, "Cannot reject a non-pending offer.");
        status = OfferStatus.REJECTED;

        // Transfer STRATS back to the purchaser
        for (uint i = 0; i < stratAssetAddresses.length; i++) {
            address stratAsset = stratAssetAddresses[i];
            STRATSTokens token = STRATSTokens(stratAsset);
            uint transferNumber = ((keccak256(string (address(this)), string(address(a)), string(block.timestamp)) + i + block.timestamp) % 1000000);
            token._transfer(purchaser, quantity, true, transferNumber, offerPrice);
        }
        return RestStatus.OK;
    }

    // Update offer status and transfer strats back to the purchaser
    function cancel() public requirePurchaser("cancel the Offer") returns (uint) {
        require(status == OfferStatus.PENDING, "Cannot cancel a non-pending offer.");
        status = OfferStatus.CANCELLED;

        // Transfer STRATS back to the purchaser
        for (uint i = 0; i < stratAssetAddresses.length; i++) {
            address stratAsset = stratAssetAddresses[i];
            STRATSTokens token = STRATSTokens(stratAsset);
            uint transferNumber = ((keccak256(string (address(this)), string(address(a)), string(block.timestamp)) + i + block.timestamp) % 1000000);
            token._transfer(purchaser, quantity, true, transferNumber, offerPrice);
        }
        return RestStatus.OK;
    }
}
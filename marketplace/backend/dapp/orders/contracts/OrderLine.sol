import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "./Order.sol";
import "./OrderStatus.sol";
import "/dapp/items/contracts/Item.sol";
import "/dapp/items/contracts/ItemStatus.sol";

/// @title A representation of OrderLine assets
contract OrderLine_2 is ItemStatus, OrderStatus {
    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public orderAddress;
    address public productId;
    address public inventoryId;
    uint public quantity;
    uint public pricePerUnit;
    uint public tax;
    uint public shippingCharges;
    uint public createdDate;
    bool public isSerialUploaded;

    address[] public itemsAddresses;

    constructor(
        address _orderAddress,
        address _productId,
        address _inventoryId,
        uint _quantity,
        uint _pricePerUnit,
        uint _shippingCharges,
        uint _tax,
        uint _createdDate
    ) public {
        owner = tx.origin;

        orderAddress = _orderAddress;
        productId = _productId;
        inventoryId = _inventoryId;
        quantity = _quantity;
        pricePerUnit = _pricePerUnit;
        shippingCharges = _shippingCharges;
        tax = _tax;
        createdDate = _createdDate;
        isSerialUploaded = false;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    modifier onlyOwnerOrganization() {
        mapping(string => string) ownerCert = getUserCert(owner);
        string assetOwner = ownerCert["organization"];
        require(assetOwner == ownerOrganization, "You are not the owner.");
        _;
    }
}

import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/orders/contracts/orders/Sales/ClothingSale.sol";

pragma es6;
pragma strict;
import <1e23e3989728fa5fc5ca6d6d3cd01cdc889434f9>;

/// @title A representation of Clothing assets
contract Clothing is ItemStatus, RestStatus, Asset {
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public serialNumber;
    ItemStatus public status;
    string public comment; // to store remarks if the item is removed from the application.
    uint public itemNumber;
    string public brand;

    event OwnershipUpdate(
        string seller,
        string newOwner,
        uint ownershipStartDate,
        address itemAddress
    );

    constructor(
        string _serialNumber,
        ItemStatus _status,
        string _comment,
        uint _itemNumber,
        uint _createdDate,
        address _owner,
        string _name,
        string _description,
        string[] _images,
        uint _price,
        string _brand,
        SaleState _saleState,
        PaymentType _paymentType
    ) public Asset(_name, _description, _images, _price, _createdDate){
        owner = _owner;

        serialNumber = _serialNumber;
        status = _status;
        comment = _comment;
        itemNumber = _itemNumber;
        brand = _brand;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];

        createSale(_saleState, _paymentType);
    }

    function createSale(SaleState _state, PaymentType _payment) public requireOwner("Create sale") returns (uint) {// can be overridden
        require(address(sale) == address(0), "An open bill of sale already exists for this asset");
        sale = new ClothingSale(address(this), _state, _payment);
        whitelistSale(sale);
        return RestStatus.OK;
    }

    function update(
        ItemStatus _status,
        string _comment,
        uint _scheme
    ) returns (uint) {
        if (ownerOrganization != getUserOrganization(tx.origin)) {
            return RestStatus.FORBIDDEN;
        }

        if (_scheme == 0) {
            return RestStatus.OK;
        }

        if ((_scheme & (1 << 0)) == (1 << 0)) {
            status = _status;
        }
        if ((_scheme & (1 << 1)) == (1 << 1)) {
            comment = _comment;
        }

        return RestStatus.OK;
    }

    // Get the userOrganization
    function getUserOrganization(address caller) public returns (string) {
        mapping(string => string) ownerCert = getUserCert(caller);
        string userOrganization = ownerCert["organization"];
        return userOrganization;
    }

    function generateOwnershipHistory(
        string _seller,
        string _newOwner,
        uint _ownershipStartDate,
        address _itemAddress
    ) returns (uint) {
        if (ownerOrganization != getUserOrganization(tx.origin)) {
            return RestStatus.FORBIDDEN;
        }
        emit OwnershipUpdate(
            _seller,
            _newOwner,
            _ownershipStartDate,
            _itemAddress
        );
        return RestStatus.OK;
    }
}

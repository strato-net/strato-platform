import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/items/contracts/ItemStatus.sol";

pragma es6;
pragma strict;
import <f1bf0f62ba0ca6d7c7b7486d33d0a264ba8e38ed>;

/// @title A representation of Item assets
contract Art is ItemStatus, Asset {
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public serialNumber;
    ItemStatus public status;
    string public comment; // to store remarks if the item is removed from the application.
    uint public itemNumber;
    uint public createdDate;
    uint public artQuantity;

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
        string _desc,
        uint _artQuantity,
        string[] _images,
        uint _price,
        SaleState _saleState,
        PaymentType _paymentType
    ) public Asset(_name, _desc, _images, _price, _saleState, _paymentType ){
        owner = _owner;

        serialNumber = _serialNumber;
        status = _status;
        comment = _comment;
        createdDate = _createdDate;
        itemNumber = _itemNumber;
        artQuantity = _artQuantity;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];

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

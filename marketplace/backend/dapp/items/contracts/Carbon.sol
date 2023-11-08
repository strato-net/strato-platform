import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/items/contracts/ItemStatus.sol";

pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of Carbon assets
contract Carbon is ItemStatus, RestStatus, Asset {
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public serialNumber;
    ItemStatus public status;
    string public comment; // to store remarks if the item is removed from the application.
    uint public itemNumber;
    string public projectType;

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
        string _projectType,
        SaleState _saleState,
        PaymentType _paymentType
    ) public Asset(_name, _description, _images, _price, _createdDate, _saleState, _paymentType ){
        owner = _owner;

        serialNumber = _serialNumber;
        status = _status;
        comment = _comment;
        itemNumber = _itemNumber;
        projectType = _projectType;

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

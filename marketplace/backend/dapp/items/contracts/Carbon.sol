import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/orders/contracts/Sales/CarbonSale.sol";
import "/dapp/mercata-base-contracts/Templates/Assets/UTXO.sol";

pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of Carbon assets
contract Carbon is ItemStatus, RestStatus, UTXO {
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public serialNumber;
    ItemStatus public status;
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
        uint _itemNumber,
        uint _createdDate,
        address _owner,
        string _name,
        string _description,
        string[] _images,
        uint _price,
        string _projectType,
        PaymentType[] _paymentTypes,
        uint _units,
        bool createNewSale
    ) public UTXO(_name, _description, _images, _createdDate, _units, _serialNumber){
        owner = _owner;

        status = _status;
        itemNumber = _itemNumber;
        projectType = _projectType;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];

        if (createNewSale) {
            for (uint i = 0; i < _paymentTypes.length; i++) {
                createSale(_paymentTypes[i], _price);
            }
        }
    }

    function createSale(PaymentType _payment, uint _price) public requireOwner("Create sale") returns (uint) {// can be overridden
        whitelistedSales.push(address(Sale(new CarbonSale(address(this), _payment, _price))));
        return RestStatus.OK;
    }

    function resell(
        uint _price,
        PaymentType[] _paymentTypes
    ) returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            createSale(_paymentTypes[i], _price);
        }  
        return RestStatus.OK;
    }

import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/orders/contracts/Sales/CarbonSale.sol";
import "/dapp/mercata-base-contracts/Templates/Assets/UTXO.sol";

pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of Carbon assets
contract Carbon is ItemStatus, RestStatus, Asset {
    uint public units; // Number of units this asset represents
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public serialNumber;
    ItemStatus public status;
    uint public itemNumber;
    string public projectType;

    event AssetSplit(address newAsset, uint unitsMoved);
    event OwnershipUpdate(string seller, string newOwner, uint ownershipStartDate, address itemAddress);

    constructor(
        string _name,
        string _description,
        string[] _images,
        uint _createdDate,
        uint _units,
        uint _serialNumber,
        ItemStatus _status,
        uint _itemNumber,
        uint _price,
        address _owner,
        string _projectType,
        PaymentType[] _paymentTypes,
        uint _units,
        bool createNewSale
    ) Asset(_name, _description, _images, _createdDate) {
        units = _units;
        serialNumber = _serialNumber;
        owner = _owner;

        status = _status;
        itemNumber = _itemNumber;
        projectType = _projectType;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];

        if(createNewSale) {
            for (uint i = 0; i < _paymentTypes.length; i++) {
                createSale(_paymentTypes[i], _price);
            }
        }
    }

    function splitAsset(uint splitUnits) public requireOwner("Split Asset") returns (address) {
        require(splitUnits < units, "Cannot split more units than available");
        Carbon newAsset = new Carbon(name, description, images, createdDate, splitUnits, (serialNo+1), status, itemNumber, 0, owner, projectType, SaleState.NONE, PaymentType.NONE, true);
        units -= splitUnits;

        emit AssetSplit(address(newAsset), splitUnits);

        return address(newAsset);
    }

    function createSale(PaymentType _payment, uint _price) public requireOwner("Create sale") returns (uint) {
        whitelistedSales.push(address(new CarbonSale(address(this), _payment, _price, _units)));
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
}

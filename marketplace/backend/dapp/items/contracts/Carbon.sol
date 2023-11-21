import "/dapp/orders/contracts/Sales/CarbonSale.sol";

pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of Carbon assets
contract Carbon is ItemStatus, RestStatus, Asset {
    uint public units; // Number of units this asset represents
    uint public serialNumber;
    ItemStatus public status;
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
        uint _price,
        address _owner,
        string _projectType,
        PaymentType[] _paymentTypes
    ) Asset(_name, _description, _images, _createdDate) {
        units = _units;
        serialNumber = _serialNumber;
        owner = _owner;

        status = _status;
        projectType = _projectType;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];

        if(_paymentTypes.length > 0) {
            createSales(_paymentTypes, _price, _units);
        }
    }

    function splitAsset(address saleContract, uint splitUnits, address newOwner) public requireOwner("split asset") returns (address) {
        require(splitUnits < units, "Cannot split more units than available");
        Carbon newAsset = new Carbon(name,
                                     description, 
                                     images, 
                                     createdDate, 
                                     splitUnits, 
                                     serialNumber, 
                                     ItemStatus.UNPUBLISHED,
                                     0, 
                                     newOwner, 
                                     projectType, 
                                     []);
        units -= splitUnits;

        dewhitelistSale(saleContract);

        for (uint i = 0; i < whitelistedSales.length; i++) {
            CarbonSale(whitelistedSales[i]).changeUnitQuantity(units);
        }

        emit AssetSplit(address(newAsset), splitUnits);

        return address(newAsset);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price, uint _units) public requireOwner("create sale") returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
                whitelistSale(address(new CarbonSale(address(this), _paymentTypes[i], _price, _units)));
        }
        return RestStatus.OK;
    }

    function createSplitSale(PaymentType _paymentType, uint _price, uint _units) public returns (uint) {
        whitelistSale(address(new CarbonSale(address(this), _paymentType, _price, _units)));
        return RestStatus.OK;
    }
}

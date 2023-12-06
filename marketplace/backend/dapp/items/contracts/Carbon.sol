import "/dapp/orders/contracts/Sales/CarbonSale.sol";

pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of Carbon assets
contract Carbon is ItemStatus, RestStatus, Asset {
    uint public units; // Number of units this asset represents

    event AssetSplit(address newAsset, uint unitsMoved);
    event OwnershipUpdate(string seller, string newOwner, uint ownershipStartDate, address itemAddress);

    constructor(
        string _name,
        string _description,
        string[] _images,
        uint _createdDate,
        uint _units,
        ItemStatus _status,
        uint _price,
        address _owner,
        PaymentType[] _paymentTypes
    ) Asset(_name, _description, _images, _createdDate) {
        units = _units;
        owner = _owner;

        status = _status;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];

        if(_paymentTypes.length > 0) {
            createSales(_paymentTypes, _price, _units);
        }
    }

    function changeUnitQuantity(uint _units) public requireOwner("change unit quantity") {
        for (uint i = 0; i < whitelistedSales.length; i++) {
            CarbonSale(whitelistedSales[i]).changeSaleQuantity(_units);
        }
    }

    function splitAsset(address saleContract, uint splitUnits, address newOwner) public requireOwner("split asset") returns (address) {
        require(splitUnits < units, "Cannot split more units than available");
        Carbon newAsset = new Carbon(name,
                                     description, 
                                     images, 
                                     createdDate, 
                                     splitUnits,
                                     ItemStatus.UNPUBLISHED,
                                     0, 
                                     newOwner,
                                     []);
        units -= splitUnits;

        changeUnitQuantity(units);

        emit AssetSplit(address(newAsset), splitUnits);

        return address(newAsset);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price, uint _units) public requireOwner("create sale") returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new CarbonSale(address(this), _paymentTypes[i], _price, _units)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function createSplitSale(PaymentType _paymentType, uint _price, uint _units) public returns (uint, string) {
        address newSale = address(new CarbonSale(address(this), _paymentType, _price, _units));
        return (RestStatus.OK, string(newSale));
    }

    function update(
        ItemStatus _status,
        uint _price
    ) public requireOwner("update carbon") returns (uint) {
        updateAsset(name, description, images, _status, _price);
        return RestStatus.OK;
    }
}

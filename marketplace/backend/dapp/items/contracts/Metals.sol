import "/dapp/orders/contracts/Sales/MetalsSale.sol";

pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

contract UnitOfMeasurement {
enum UnitOfMeasurement {
    NULL,
    TON,
    POUND,
    OUNCE,
    TONNE,
    KG,
    G   
}
}

/// @title A representation of Metals assets
contract Metals is ItemStatus, UnitOfMeasurement, RestStatus, Asset {
    // description would have the acutal product details of units and stuff
    // least sellable unit = #
    // unit of measurement
    // user should set correct units (# of least sellable units)

    // can fractionalize product; what is smallest unit can be sold in?
    // least sellable unit
    // units sellable = (sellableNumUnits, sellableUnitType) ex: 5 KG
    // units describes sellable units not product units
    UnitOfMeasurement public unitOfMeasurement;
    uint public leastSellableUnits;
    string public source; //call manufacturer instead?
    string purity;
    uint public units;
    string serialNumber;

    event AssetSplit(address newAsset, uint unitsMoved);
    event OwnershipUpdate(
        string seller,
        string newOwner,
        uint ownershipStartDate,
        address itemAddress
    );

    constructor(
        UnitOfMeasurement _unitOfMeasurement,
        uint _leastSellableUnits,
        string _source,
        string _purity,
        address _owner,
        string _name,
        string _description,
        string[] _images,
        uint _createdDate,
        uint _units,
        uint _price,
        string _serialNumber, // unused
        ItemStatus _status,
        PaymentType[] _paymentTypes
    )  Asset(_name, _description, _images, _createdDate){
        owner = _owner;

        unitOfMeasurement = _unitOfMeasurement;
        leastSellableUnits = _leastSellableUnits;
        purity = _purity;
        source = _source;
        serialNumber = _serialNumber;
        units = _units;
        status = _status;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];

        if(_paymentTypes.length > 0) {
            createSales(_paymentTypes, _price, _units);
        }
    }

    function changeUnitQuantity(uint _units) public requireOwner("change unit units") {
        for (uint i = 0; i < whitelistedSales.length; i++) {
            MetalsSale(whitelistedSales[i]).changeSaleQuantity(_units);
        }
    }

    function splitAsset(address saleContract, uint splitUnits, address newOwner) public requireOwner("split asset") returns (address) {
        require(splitUnits < units, "Cannot split more units than available");
        MetalsSale sale = MetalsSale(saleContract);
        Metals newMetals = new Metals(unitOfMeasurement,
            leastSellableUnits,
            source,
            purity,
            newOwner,
            name,
            description,
            images,
            createdDate,
            splitUnits,
            sale.price(),
            serialNumber,
            ItemStatus.UNPUBLISHED,
            []);
        units -= splitUnits;
        changeUnitQuantity(units);
        emit AssetSplit(address(newMetals), splitUnits);
        return address(newMetals);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price, uint _units) public requireOwner("create sales") returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new MetalsSale(address(this), _paymentTypes[i], _price, _units)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function createSplitSale(PaymentType _paymentType, uint _price, uint _units) public returns (uint, string) {
        address newSale = address(new MetalsSale(address(this), _paymentType, _price, _units));
        return (RestStatus.OK, string(newSale));
    }

    function updateMetals(
        UnitOfMeasurement _unitOfMeasurement,
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        string _serialNumber,
        string _source,
        uint _price,
        uint _units
    ) public requireOwner("update metals") returns (uint) {
        serialNumber = _serialNumber;
        unitOfMeasurement = _unitOfMeasurement;
        source = _source;
        updateAsset(_name, _description, _images, _status, _price);
        if(_units != units)
        {
            changeUnitQuantity(_units);
            units = _units;
        }
        return RestStatus.OK;
    }
}
import "/dapp/orders/contracts/Sales/MetalsSale.sol";

pragma es6;
pragma strict;
import <4244a06baf12f75617016f4785897ab80e4daf3c>;

enum UnitOfMeasurement {
    TON,
    POUND,
    OUNCE,
    TONNE,
    KG,
    G   
}

/// @title A representation of Metals assets
contract Metals is ItemStatus, RestStatus, UTXOAsset {
    // description would have the acutal product details of units and stuff
    // least sellable unit = #
    // unit of measurement
    // user should set correct quantity (# of least sellable units)

    // can fractionalize product; what is smallest unit can be sold in?
    // least sellable unit
    // units sellable = (sellableNumUnits, sellableUnitType) ex: 5 KG
    // quantity describes sellable units not product units
    UnitOfMeasurement public sellableUnitOfMeasurement;
    uint public leastSellableUnits;
    string public source; //call manufacturer instead?
    string purity;
    //string country;
    
    event OwnershipUpdate(
        string seller,
        string newOwner,
        uint ownershipStartDate,
        address itemAddress
    );

    constructor(
        UnitOfMeasurement _sellableUnitOfMeasurement,
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
        PaymentType[] _paymentTypes
    ) public UTXOAsset(_name, _description, _images, _createdDate, _units){
        owner = _owner;

        sellableUnitOfMeasurement = _sellableUnitOfMeasurement;
        leastSellableUnits = _leastSellableUnits;
        purity = _purity;
        source = _source;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];

        if(_paymentTypes.length > 0) {
            createSales(_paymentTypes, _price, _units);
        }
    }

    function createSales(PaymentType[] _paymentTypes, uint _price, uint _quantity) public requireOwner("create sales") returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new MetalsSale(address(this), _paymentTypes[i], _price, _quantity)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function updateMetals( //should you be able to update quantity?...
        UnitOfMeasurement _sellableUnitOfMeasurement,
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        // string _serialNumber,
        string _source,
        uint _price
    ) public requireOwner("update metals") returns (uint) {
        // serialNumber = _serialNumber;
        sellableUnitOfMeasurement = _sellableUnitOfMeasurement;
        source = _source;
        updateAsset(_name, _description, _images, _status, _price);
        return RestStatus.OK;
    }
}
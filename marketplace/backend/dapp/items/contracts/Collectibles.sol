import "/dapp/orders/contracts/Sales/CollectiblesSale.sol";

pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of Collectible assets
contract Collectibles is ItemStatus, RestStatus, Asset {
    string public serialNumber;
    string public condition;
    uint public units;

    event OwnershipUpdate(
        string seller,
        string newOwner,
        uint ownershipStartDate,
        address itemAddress
    );

    constructor(
        string _serialNumber,
        uint _createdDate,
        address _owner,
        string _name,
        string _description,
        string[] _images,
        uint _price,
        string _condition,
        uint _units,
        ItemStatus _status,
        PaymentType[] _paymentTypes
    ) public Asset(_name, _description, _images, _createdDate){

        owner = _owner;
        serialNumber = _serialNumber;
        condition = _condition;
        units = _units;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];

        createSales(_paymentTypes, _price, _units);
    }

    function changeUnitQuantity(uint _units) public requireOwner("change unit quantity") {
        for (uint i = 0; i < whitelistedSales.length; i++) {
            CollectiblesSale(whitelistedSales[i]).changeSaleQuantity(_units);
        }
    }

    function splitAsset(address saleContract, uint splitUnits, address newOwner) public requireOwner("split asset") returns (address) {
        require(splitUnits < units, "Cannot split more units than available");
        Collectibles newAsset = new Collectibles(serialNumber + "1", 
                                     createdDate, 
                                     newOwner, 
                                     name,
                                     description, 
                                     images, 
                                     0,
                                     condition,
                                     splitUnits, 
                                     ItemStatus.UNPUBLISHED,
                                     []);
        units -= splitUnits;

        changeUnitQuantity(units);

        emit AssetSplit(address(newAsset), splitUnits);

        return address(newAsset);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price, uint _units) public requireOwner("Create sale") returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new CollectiblesSale(address(this), _paymentTypes[i], _price, _units)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function createSplitSale(PaymentType _paymentType, uint _price, uint _units) public returns (uint, string) {
        address newSale = address(new CollectiblesSale(address(this), _paymentType, _price, _units));
        return (RestStatus.OK, string(newSale));
    }


    // TODO: Finish the update function. 
    function updateCollectible(
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        string _serialNumber,
        uint _price
    ) public requireOwner("update collectible") returns (uint) {
        serialNumber = _serialNumber;
        updateAsset(_name, _description, _images, _status, _price);
        return RestStatus.OK;
    }
}
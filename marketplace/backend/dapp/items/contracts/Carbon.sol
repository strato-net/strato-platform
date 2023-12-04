import "/dapp/orders/contracts/Sales/CarbonSale.sol";

pragma es6;
pragma strict;
import <afa8348e8e0305b2ac801b0ea20790bd7b638554>;

/// @title A representation of Carbon assets
contract Carbon is ItemStatus, RestStatus, UTXO {
    string public projectType;

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
        string _projectType,
        PaymentType[] _paymentTypes
    ) UTXO (
        _name,
        _description,
        _images,
        _createdDate,
        _units,
        _serialNumber
    ) {
        status = _status;
        projectType = _projectType;

        if(_paymentTypes.length > 0) {
            createSales(_paymentTypes, _price);
        }
    }

    // function changeUnitQuantity(uint _units) public requireOwner("change unit quantity") {
    //     for (uint i = 0; i < whitelistedSales.length; i++) {
    //         CarbonSale(whitelistedSales[i]).changeSaleQuantity(_units);
    //     }
    // }

    function mint(uint splitUnits) internal override returns (UTXO) {
        Carbon c = new Carbon(name,
                              description, 
                              images, 
                              createdDate, 
                              splitUnits, 
                              serialNumber + 1, 
                              ItemStatus.UNPUBLISHED,
                              0, 
                              projectType, 
                              []);
        return UTXO(c);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price) public requireOwner("create sale") returns (uint) {
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new CarbonSale(address(this), _paymentTypes[i], _price)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function createSplitSale(PaymentType _paymentType, uint _price) public returns (uint, string) {
        address newSale = address(new CarbonSale(address(this), _paymentType, _price));
        return (RestStatus.OK, string(newSale));
    }

    function updateCarbon(
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        uint _serialNumber,
        string _projectType,
        uint _price
    ) public requireOwner("update carbon") returns (uint) {
        serialNumber = _serialNumber;
        projectType = _projectType;
        updateAsset(_name, _description, _images, _status, _price);
        return RestStatus.OK;
    }
}

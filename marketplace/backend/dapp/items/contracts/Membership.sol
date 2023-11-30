import "/dapp/orders/contracts/Sales/MembershipSale.sol";

pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of Membership assets
contract Membership is ItemStatus, RestStatus, Asset {
    uint public units; // Number of units this asset represents
    string public serialNumber;
    string public projectType;
    uint expirationPeriodInMonths;
    uint expirationDate;
    event AssetSplit(address newAsset, uint unitsMoved);
    event OwnershipUpdate(string seller, string newOwner, uint ownershipStartDate, address itemAddress);

    constructor(
        string _name,
        string _description,
        string[] _images,
        uint _createdDate,
        uint _units,
        string _serialNumber,
        ItemStatus _status,
        uint _price,
        address _owner,
        string _projectType,
        PaymentType[] _paymentTypes,
        uint _expirationPeriodInMonths,
        uint uid
    ) Asset(_name, _description, _images, _createdDate) {
        units = _units;
        serialNumber = _serialNumber;
        owner = _owner;

        status = _status;
        projectType = _projectType;
        expirationDate = block.timestamp + (_expirationPeriodInMonths * 30 days);
        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];
        expirationPeriodInMonths =_expirationPeriodInMonths;
        expirationDate = _expirationPeriodInMonths * 2592000;
        if(_paymentTypes.length > 0) {
            createSales(_paymentTypes, _price, _units);
        }
    }

    function changeUnitQuantity(uint _units) public requireOwner("change unit quantity") {
        require(block.timestamp < expirationDate, "Membership is expired");
        for (uint i = 0; i < whitelistedSales.length; i++) {
            MembershipSale(whitelistedSales[i]).changeSaleQuantity(_units);
        }
    }

    function splitAsset(address saleContract, uint splitUnits, address newOwner) public requireOwner("split asset") returns (address) {
        require(block.timestamp < expirationDate, "Membership is expired");
        require(splitUnits < units, "Cannot split more units than available");
        Membership newAsset = new Membership(name,
                                     description, 
                                     images, 
                                     createdDate, 
                                     splitUnits, 
                                     serialNumber + "1", 
                                     ItemStatus.UNPUBLISHED,
                                     0, 
                                     newOwner, 
                                     projectType, 
                                     []);
        units -= splitUnits;

        changeUnitQuantity(units);

        emit AssetSplit(address(newAsset), splitUnits);

        return address(newAsset);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price, uint _units) public requireOwner("create sale") returns (uint) {
        require(block.timestamp < expirationDate, "Membership is expired");
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new MembershipSale(address(this), _paymentTypes[i], _price, _units)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function createSplitSale(PaymentType _paymentType, uint _price, uint _units) public returns (uint, string) {
        require(block.timestamp < expirationDate, "Membership is expired");
        address newSale = address(new MembershipSale(address(this), _paymentType, _price, _units));
        return (RestStatus.OK, string(newSale));
    }

    function updateMembership(
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        string _serialNumber,
        string _projectType,
        uint _price,
        uint _units
    ) public requireOwner("update membership") returns (uint) {
        serialNumber = _serialNumber;
        projectType = _projectType;
        updateAsset(_name, _description, _images, _status, _price);
        if (_units != units) {
            changeUnitQuantity(_units);
            units = _units;
        }
        return RestStatus.OK;
    }

    function transferOwnership(address saleContract, string _newOwnerCommonName, address _newOwner) overrides public requireOwner("Ownership transfer") {
        require(block.timestamp < expirationDate, "Membership is expired");
        require(isSaleWhitelisted(saleContract), "Sale not found in whitelist");
        ownerCommonName = _newOwnerCommonName;
        owner = _newOwner;
        disableAllSales();
    }
}


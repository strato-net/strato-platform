pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of Membershipp assets
contract Membershipp is ItemStatus, RestStatus, Asset {
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
        uint _expirationPeriodInMonths
    ) Asset(_name, _description, _images, _createdDate) {
        units = _units;
        serialNumber = _serialNumber;
        owner = _owner;

        status = _status;
        projectType = _projectType;
        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];
        expirationPeriodInMonths =_expirationPeriodInMonths;
        expirationDate = block.timestamp + (expirationPeriodInMonths*2592000);
        if(_paymentTypes.length > 0) {
            createSales(_paymentTypes, _price, _units);
        }
    }

    function changeUnitQuantity(uint _units) public requireOwner("change unit quantity") {
        require(block.timestamp < expirationDate, "Membershipp is expired");
        for (uint i = 0; i < whitelistedSales.length; i++) {
            MembershippSale(whitelistedSales[i]).changeSaleQuantity(_units);
        }
    }

    function splitAsset(address saleContract, uint splitUnits, address newOwner) public requireOwner("split asset") returns (address) {
        require(block.timestamp < expirationDate, "Membershipp is expired");
        require(splitUnits < units, "Cannot split more units than available");
        Membershipp newAsset = new Membershipp(name,
                                     description, 
                                     images, 
                                     createdDate, 
                                     splitUnits, 
                                     serialNumber + "1", 
                                     ItemStatus.UNPUBLISHED,
                                     0, 
                                     newOwner, 
                                     projectType, 
                                     [],
                                     expirationPeriodInMonths
                                     );
        units -= splitUnits;

        changeUnitQuantity(units);

        emit AssetSplit(address(newAsset), splitUnits);

        return address(newAsset);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price, uint _units) public requireOwner("create sale") returns (uint) {
        require(block.timestamp < expirationDate, "Membershipp is expired");
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new MembershippSale(address(this), _paymentTypes[i], _price, _units)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function createSplitSale(PaymentType _paymentType, uint _price, uint _units) public returns (uint, string) {
        require(block.timestamp < expirationDate, "Membershipp is expired");
        address newSale = address(new MembershippSale(address(this), _paymentType, _price, _units));
        return (RestStatus.OK, string(newSale));
    }

    function updateMembershipp(
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        string _serialNumber,
        string _projectType,
        uint _price,
        uint _units
    ) public requireOwner("update membershipp") returns (uint) {
        serialNumber = _serialNumber;
        projectType = _projectType;
        updateAsset(_name, _description, _images, _status, _price);
        if (_units != units) {
            changeUnitQuantity(_units);
            units = _units;
        }
        return RestStatus.OK;
    }

    function transferOwnership(address saleContract, address _newOwner) override public requireOwner("ownership transfer") {
        require(block.timestamp < expirationDate, "Membershipp is expired");
        require(isSaleWhitelisted(saleContract), "Sale not found in whitelist");
        disableAllSales();
        status = ItemStatus.UNPUBLISHED;
        owner = _newOwner;
        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];
   }
}

contract MembershippSale is Sale{
    uint public units;

    constructor(address _assetToBeSold, PaymentType _payment, uint _price, uint _units) Sale(_assetToBeSold, _price, _payment){
        units=_units;
    }

    function changeSaleQuantity(uint _units) public requireSeller("change unit quantity") {
        units = _units;
    }

    function transferOwnership(address _purchasersAddress, uint _orderId) public requireSeller("transfer ownership of Asset") override returns (uint) {
        saleOrderID = _orderId;
        executeUTXOSale(_purchasersAddress);
        state = SaleState.Closed;
        return RestStatus.OK;
    }

    function executeUTXOSale(address _purchasersAddress, uint[] ) public requireSeller("execute UTXO sale") {
            // Before executing the sale, ensure the asset is a UTXO asset
            Membershipp membershippAsset = Membershipp(address(assetToBeSold));

            // Iterate over the units and create a new Membershipp instance for each unit
            for (uint i = 0; i < units; i++) {//loop 10 times
                // Call splitAsset on the UTXO asset for each unit
                address newMembershippAssetAddress = membershippAsset.splitAsset(address(this), 1, _purchasersAddress);

                // Create a new instance of Membershipp with a quantity of 1
                Membershipp newMembershippAsset = Membershipp(newMembershippAssetAddress);

            }

            // Update the original asset's units
            assetToBeSold = Membershipp(newCarbonAsset); 
    }
}


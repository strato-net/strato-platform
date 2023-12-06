contract SemiFungible is ItemStatus, RestStatus, Asset {
    uint public units; // Number of units this asset represents
    string public serialNumber;
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
        PaymentType[] _paymentTypes,
        uint _expirationPeriodInMonths,
        uint uid
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

    function splitAsset(address saleContract, uint[] splitUnitsArray, address newOwner) public requireOwner("split asset") returns (address[] memory) {
        uint totalSplitUnits = 0;
        for (uint i = 0; i < splitUnitsArray.length; i++) {
            totalSplitUnits += splitUnitsArray[i];
        }
        require(totalSplitUnits = units, "Cannot split more/less units than available");

        address[] newAssets;

        //for example:
        //splitUnitsArray for SemiFungible will be [1,1,1,1,1] if someone buys 5 semiFungibles
        //splitUnitsArray for Carbon will be [5] if someone buys 5 semiFungibles
        for (uint i = 0; i < splitUnitsArray.length; i++) {
            mint(
                name,
                description,
                images,
                createdDate,
                splitUnitsArray[i],
                serialNumber + i+1,
                ItemStatus.UNPUBLISHED,
                0,
                newOwner,
                projectType,
                new string[](0)
            );

            newAssets.push(address(newAsset));
            emit AssetSplit(address(newAsset), splitUnitsArray[i]);
        }

        mint(
                name,
                description,
                images,
                createdDate,
                (units-totalSplitUnits),
                serialNumber + 1,
                ItemStatus.UNPUBLISHED,
                0,
                newOwner,
                projectType,
                new string[](0)
            );

        newAssets.push(address(newAsset));
        emit AssetSplit(address(newAsset), splitUnitsArray[i]);

        return newAssets;
    }

    function mint(string _name,
        string _description,
        string[] _images,
        uint _createdDate,
        uint _units,
        string _serialNumber,
        ItemStatus _status,
        uint _price,
        address _owner,
        PaymentType[] _paymentTypes,
        uint _expirationPeriodInMonths,
        uint uid) internal virtual public returns(){
            SemiFungible newAsset = new SemiFungible(
                _name,
                _description,
                _images,
                _createdDate,
                _units,
                _serialNumber,
                _status,
                _price,
                _owner,
                _paymentTypes,
                _expirationPeriodInMonths
                    );

            newAssets.push(address(newAsset));
            emit AssetSplit(address(newAsset), splitUnitsArray[i]);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price, uint _units) public requireOwner("create sale") returns (uint) {
        require(block.timestamp < expirationDate, "SemiFungible is expired");
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new SemiFungibleSale(address(this), _paymentTypes[i], _price, _units)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function createSplitSale(PaymentType _paymentType, uint _price, uint _units) public returns (uint, string) {
        require(block.timestamp < expirationDate, "SemiFungible is expired");
        address newSale = address(new SemiFungibleSale(address(this), _paymentType, _price, _units));
        return (RestStatus.OK, string(newSale));
    }

    function updateSemiFungible(
        string _name, 
        string _description, 
        string[] _images, 
        ItemStatus _status,
        string _serialNumber,
        uint _price,
        uint _units
    ) public requireOwner("update semiFungible") returns (uint) {
        serialNumber = _serialNumber;
        updateAsset(_name, _description, _images, _status, _price);
        if (_units != units) {
            changeUnitQuantity(_units);
            units = _units;
        }
        return RestStatus.OK;
    }
}
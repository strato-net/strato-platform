pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

abstract contract SemiFungible is ItemStatus, RestStatus, Asset {
    uint public units; // Number of units this asset represents
    string public serialNumber;
    bool public spent;

    // mapping (address => uint) lockedUnits;
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
        PaymentType[] _paymentTypes
    ) Asset(_name, _description, _images, _createdDate) {
        units = _units;
        serialNumber = _serialNumber;
        owner = _owner;
        spent = false;

        status = _status;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerCommonName = ownerCert["commonName"];
        
    }

    function splitAsset(address orderAddress, uint _units, address newOwner) public requireOwner("split asset") returns (address[] memory) {
        // uint splitUnits = takeLockedUnits(orderAddress);
        require(spent==false, "Cannot split more units for spent Membership");
        require(_units <= units, "Cannot split more units than available");
        // Ensure there are enough unlocked units available for the split
        // require(_units <= lockedUnits[orderAddress], "Not enough unlocked units to split");

        address[] newAssets;

        //for example:
        //splitUnitsArray for SemiFungible will be [1,1,1,1,1] if someone buys 5 semiFungibles
        //splitUnitsArray for Carbon will be [5] if someone buys 5 semiFungibles
        for (uint i = 0; i < _units; i++) {
            SemiFungible sf = SemiFungible(mint(
                name,
                description,
                images,
                createdDate,
                1,
                serialNumber,
                ItemStatus.UNPUBLISHED,
                0,
                owner,
                []
            ));
            Asset(sf).whitelistSale(msg.sender);
            Asset(sf).transferOwnership(msg.sender, newOwner);

            newAssets.push(address(sf));
        }

        SemiFungible sf = SemiFungible(mint(
                name,
                description,
                images,
                createdDate,
                (units-_units),
                serialNumber,
                ItemStatus.UNPUBLISHED,
                0,
                owner,
                []
            ));

        newAssets.push(address(sf));
        spent = true;
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
        PaymentType[] _paymentTypes) virtual internal returns(address){
        // require(block.timestamp < expirationDate, "Membershipt is expired");
        require(spent==false, "Cannot mint more units for spent Membership");
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
                _paymentTypes
                    );
        return address(newAsset);
            // emit AssetSplit(address(newAsset), splitUnitsArray[i]);
    }

    function createSales(PaymentType[] _paymentTypes, uint _price, uint _units) public requireOwner("create sale") returns (uint) {
        // require(block.timestamp < expirationDate, "SemiFungible is expired");
        require(spent==false, "Cannot createSales for spent Membership");
        for (uint i = 0; i < _paymentTypes.length; i++) {
            whitelistSale(address(new SemiFungibleSale(address(this), _paymentTypes[i], _price, _units)));
        }
        status = ItemStatus.PUBLISHED;
        return RestStatus.OK;
    }

    function createSplitSale(PaymentType _paymentType, uint _price, uint _units) public returns (uint, string) {
        // require(block.timestamp < expirationDate, "SemiFungible is expired");
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
        require(spent==false, "Cannot updateSemiFungible for spent Membership");
        serialNumber = _serialNumber;
        updateAsset(_name, _description, _images, _status, _price);
        if (_units != units) {
            units = _units;
        }
        return RestStatus.OK;
    }


    // function lockUnits(address orderAddress, uint unitsToLock) public requireWhitelisted("lock asset units") {
    //     require(unitsToLock <= units, "Not enough units to lock");
    //     require(lockedUnits[orderAddress] == 0, "Order has already locked units in this asset.");
    //     units -= unitsToLock;
    //     lockedUnits[orderAddress] = unitsToLock;
    // }

    // function unlockUnits(address orderAddress) public requireWhitelisted("unlock asset units") {
    //     uint unitsToReturn = takeLockedUnits(orderAddress);
    //     units += unitsToReturn;
    // }

    // function takeLockedUnits(address orderAddress) internal returns (uint) {
    //     uint unitsToUnlock = lockedUnits[orderAddress];
    //     require(unitsToUnlock > 0, "There are no units to unlock for address");
    //     lockedUnits[orderAddress] = 0;
    //     return unitsToUnlock;
    // }
}
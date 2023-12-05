import "Asset.sol";

abstract contract UTXO is Asset {
    uint public units; // Number of units this asset represents
    uint public serialNumber;
    event AssetSplit(address newAsset, uint unitsMoved);

    mapping (address => uint) lockedUnits;

    constructor(
        string _name,
        string _description,
        string[] _images,
        uint _createdDate,
        uint _units,
        uint _serialNumber
    ) Asset(_name, _description, _images, _createdDate) {
        units = _units;
        serialNumber = _serialNumber;
    }

    function mint(uint splitUnits) internal virtual returns (UTXO) {
        return new UTXO(name, description, images, createdDate, splitUnits, (serialNumber+1));
    }

    function splitAsset(address orderAddress, address purchasersAddress) public requireWhitelisted("Split Asset") returns (address) {
        uint splitUnits = takeLockedUnits(orderAddress);
        // Create a new UTXO with a portion of the units
        UTXO newAsset = mint(splitUnits);

        Asset(newAsset).whitelistSale(msg.sender);
        Asset(newAsset).transferOwnership(purchasersAddress);

        emit AssetSplit(address(newAsset), splitUnits);

        return address(newAsset);
    }

    function lockUnits(address orderAddress, uint unitsToLock) public requireWhitelisted("lock asset units") {
        require(unitsToLock <= units, "Not enough units to lock");
        require(lockedUnits[orderAddress] == 0, "Order has already locked units in this asset.");
        units -= unitsToLock;
        lockedUnits[orderAddress] = unitsToLock;
    }

    function takeLockedUnits(address orderAddress) internal returns (uint) {
        uint unitsToUnlock = lockedUnits[orderAddress];
        require(unitsToUnlock > 0, "There are no units to unlock for address " + string(orderAddress));
        lockedUnits[orderAddress] = 0;
        return unitsToUnlock;
    }

    function unlockUnits(address orderAddress) public requireWhitelisted("unlock asset units") {
        uint unitsToReturn = takeLockedUnits(orderAddress);
        units += unitsToReturn;
    }
}
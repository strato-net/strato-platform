abstract contract UTXO is Asset {
    uint public units; // Number of units this asset represents
    uint public serialNo;
    event AssetSplit(address newAsset, uint unitsMoved);

    constructor(
        string _name,
        string _description,
        string[] _images,
        uint _price,
        uint _createdDate,
        uint _units,
        string _serialNo
    ) Asset(_name, _description, _images, _createdDate) {
        units = _units;
        serialNo = _serialNo;
    }

    function splitAsset(uint splitUnits) public requireOwner("Split Asset") returns (address newAssetAddress) {
        require(splitUnits < units, "Cannot split more units than available");
        // Create a new UTXO with a portion of the units
        UTXO newAsset = new UTXO(name, description, images, price, createdDate, splitUnits, (serialNo+1));
        units -= splitUnits; // Reduce the units in the current contract

        emit AssetSplit(address(newAsset), splitUnits);

        return address(newAsset);
    }
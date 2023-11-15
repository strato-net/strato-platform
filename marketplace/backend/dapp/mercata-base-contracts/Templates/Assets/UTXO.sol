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
    ) Asset(_name, _description, _images, _price, _createdDate) {
        units = _units;
        serialNo = _serialNo;
        createSale(_state, _payment);
    }

    function splitAsset(uint splitUnits, string ownerCommonName) public requireOwner("Split Asset") returns (address newAssetAddress) {
        require(address(sale) != address(0), "An open bill of sale should exist for this asset");
        require(msg.sender == address(sale), "Unauthorized: caller is not the Sale contract");
        require(splitUnits < units, "Cannot split more units than available");
        // Create a new UTXO with a portion of the units
        UTXO newAsset = new UTXO(name, description, images, price, createdDate, splitUnits, (serialNo+1),sale.state(), sale.payment());
        units -= splitUnits; // Reduce the units in the current contract

        emit AssetSplit(address(newAsset), splitUnits);

        return address(newAsset);
    }
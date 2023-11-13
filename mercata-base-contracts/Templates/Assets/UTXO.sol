contract UTXO is Asset {
    uint public units; // Number of units this asset represents
    uint public serialNo;
    event AssetSplit(address newAsset, uint unitsMoved);

    constructor(
        string memory _name,
        string memory _description,
        string[] memory _images,
        uint _price,
        uint _createdDate,
        uint _units,
        uint _serialNo,
        SaleState _state,
        PaymentType _payment
    ) Asset(_name, _description, _images, _price, _createdDate, _state, _payment) {
        units = _units;
        serialNo = _serialNo;
    }

    function splitAsset(uint splitUnits, string ownerCommonName) public requireOwner("Split Asset") returns (address newAssetAddress) {
        require(msg.sender == address(sale), "Unauthorized: caller is not the Sale contract");
        require(splitUnits < units, "Cannot split more units than available");
        // Create a new UTXO with a portion of the units
        UTXOAsset newAsset = new UTXOAsset(name, description, images, price, createdDate, splitUnits, (serialNo+1),sale.state(), sale.paymentType());
        units -= splitUnits; // Reduce the units in the current contract

        emit AssetSplit(address(newAsset), splitUnits);

        return address(newAsset);
    }
}

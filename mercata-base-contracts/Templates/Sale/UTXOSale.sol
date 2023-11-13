contract UTXOSale is Sale {

    constructor(
        address _assetToBeSold,
        SaleState _state,
        PaymentType _payment
    ) Sale(_assetToBeSold, _state, _payment) {
    }

    // Function to execute the UTXO sale
    function executeUTXOSale(uint splitUnits, string memory _purchasersCommonName) public requireSeller("Execute UTXO Sale") returns (address newAssetAddress) {
        // Before executing the sale, ensure the asset is a UTXO asset
        UTXO utxoAsset = UTXO(address(assetToBeSold));
        require(splitUnits <= utxoAsset.units(), "Cannot sell more units than available");

        // Call splitAsset on the UTXO asset
        newAssetAddress = utxoAsset.splitAsset(splitUnits, _purchasersCommonName);

        // Transfer ownership of the new asset to the purchaser
        UTXO(newAssetAddress).transferOwnership(_purchasersCommonName);

        // Update the sale state
        transferOwnership(_purchasersCommonName);

        return newAssetAddress;
    }
}

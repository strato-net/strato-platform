import "/dapp/mercata-base-contracts/Templates/Sale/Sale.sol";
import "/dapp/mercata-base-contracts/Templates/Assets/Asset.sol";

abstract contract UTXOSale is Sale {

    constructor(
        address _assetToBeSold,
        SaleState _state,
        PaymentType _payment,
        uint _price
    ) Sale(_assetToBeSold, _price, _state, _payment) {
    }


    function transferOwnership(uint splitUnits, string _purchasersCommonName, address _purchasersAddress) public requireSeller("Transfer Ownership of Asset") returns (uint) {
        executeUTXOSale(splitUnits, _purchasersCommonName, _purchasersAddress);
        return RestStatus.OK;
    }

    // Function to execute the UTXO sale
    function executeUTXOSale(uint splitUnits, string _purchasersCommonName, address _purchasersAddress) public requireSeller("Execute UTXO Sale") returns (address newAssetAddress) {
        // Before executing the sale, ensure the asset is a UTXO asset
        UTXO utxoAsset = UTXO(address(assetToBeSold));
        require(splitUnits <= utxoAsset.units(), "Cannot sell more units than available");

        // Call splitAsset on the UTXO asset
        newAssetAddress = utxoAsset.splitAsset(splitUnits, _purchasersCommonName);

        // Transfer ownership of the new asset to the purchaser
        Asset(newAssetAddress).transferOwnership(address(this), _purchasersCommonName, _purchasersAddress);    

        return newAssetAddress;
    }


}
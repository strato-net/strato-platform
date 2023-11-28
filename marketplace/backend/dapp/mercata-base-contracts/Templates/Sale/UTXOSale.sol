import "/dapp/mercata-base-contracts/Templates/Sale/Sale.sol";
import "/dapp/mercata-base-contracts/Templates/Assets/Asset.sol";

abstract contract UTXOSale is Sale {
    uint units;

    constructor(
        address _assetToBeSold,
        PaymentType _payment,
        uint _price
    ) Sale(_assetToBeSold, _price, _payment) {
    }


    function transferOwnership(string _purchasersCommonName, address _purchasersAddress, string _orderId) public requireSeller("Transfer Ownership of Asset") returns (uint) {
        saleOrderID = _orderId;
        purchasersCommonName = _purchasersCommonName;
        executeUTXOSale(_purchasersCommonName, _purchasersAddress);
        state = SaleState.Closed;
        return RestStatus.OK;
    }

    // Function to execute the UTXO sale
    function executeUTXOSale(string _purchasersCommonName, address _purchasersAddress) public requireSeller("Execute UTXO Sale") {
        // Before executing the sale, ensure the asset is a UTXO asset
        UTXO utxoAsset = UTXO(address(assetToBeSold));
        require(units <= utxoAsset.units(), "Cannot sell more units than available");

        // Call splitAsset on the UTXO asset
        newAssetAddress = utxoAsset.splitAsset(units);

        // Transfer ownership of the new asset to the purchaser
        Asset(newAssetAddress).transferOwnership(address(this), _purchasersCommonName, _purchasersAddress);
    }


}
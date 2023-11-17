pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

/// @title A representation of asset sale contract
contract CarbonSale is Sale{
    uint units;

    constructor(address _assetToBeSold, PaymentType _payment, uint _price, uint _units) Sale(_assetToBeSold, _price, _payment){
        units=_units;
    }

    function transferOwnership(string _purchasersCommonName, address _purchasersAddress) public requireSeller("Transfer Ownership of Asset") returns (uint) {
        saleOrderID = _orderId;
        purchasersCommonName = _purchasersCommonName;
        executeUTXOSale(_purchasersCommonName, _purchasersAddress);
        state = SaleState.Closed;
        return RestStatus.OK;
    }

    function executeUTXOSale(string _purchasersCommonName, address _purchasersAddress) public requireSeller("Execute UTXO Sale") returns () {
        // Before executing the sale, ensure the asset is a UTXO asset
        Carbon carbonAsset = Carbon(address(assetToBeSold));
        require(units <= carbonAsset.units(), "Cannot sell more units than available");

        // Call splitAsset on the UTXO asset
        address newAssetAddress = carbonAsset.splitAsset(units);

        // Transfer ownership of the new asset to the purchaser
        Asset(newAssetAddress).transferOwnership(address(this), _purchasersCommonName, _purchasersAddress);    
    }
}
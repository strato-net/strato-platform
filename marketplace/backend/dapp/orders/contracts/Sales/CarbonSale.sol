pragma es6;
pragma strict;
import <d85f8ab0f5bb3add2046fd57ba9ba3ef3823d005>;

/// @title A representation of asset sale contract
contract CarbonSale is Sale{
    uint units;

    constructor(address _assetToBeSold, SaleState _state, PaymentType _payment, uint _price, uint _units) Sale(_assetToBeSold, _price ,_state, _payment){
        units=_units;
    }

    function transferOwnership(string _purchasersCommonName, address _purchasersAddress) public requireSeller("Transfer Ownership of Asset") returns (uint) {
        executeUTXOSale(_purchasersCommonName, _purchasersAddress);
        return RestStatus.OK;
    }

    // Function to execute the UTXO sale
    function executeUTXOSale(string _purchasersCommonName, address _purchasersAddress) public requireSeller("Execute UTXO Sale") returns () {
        // Before executing the sale, ensure the asset is a UTXO asset
        Carbon carbonAsset = Carbon(address(assetToBeSold));
        require(units <= carbonAsset.units(), "Cannot sell more units than available");

        // Call splitAsset on the UTXO asset
        newAssetAddress = carbonAsset.splitAsset(units, _purchasersCommonName);

        // Transfer ownership of the new asset to the purchaser
        Asset(newAssetAddress).transferOwnership(address(this), _purchasersCommonName, _purchasersAddress);    
    }
}
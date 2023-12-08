pragma es6;
pragma strict;
import <23b42b72d97bb074316c5db4fdae6165346742f5>;

/// @title A representation of asset sale contract
contract CarbonSale is Sale{
    uint public units;

    constructor(address _assetToBeSold, PaymentType _payment, uint _price, uint _units) Sale(_assetToBeSold, _price, _payment){
        units=_units;
    }

    function changeSaleQuantity(uint _units) public requireSeller("change unit quantity") {
        units = _units;
    }

    function transferOwnership(address _purchasersAddress, uint _orderId) public requireSeller("transfer ownership of Asset") override returns (uint) {
        saleOrderID = _orderId;
        executeUTXOSale(_purchasersAddress);
        state = SaleState.Closed;
        return RestStatus.OK;
    }

    function executeUTXOSale(address _purchasersAddress) public requireSeller("execute UTXO sale") {
        // Before executing the sale, ensure the asset is a UTXO asset
        Carbon carbonAsset = Carbon(address(assetToBeSold));

        // If the sale is for all the base units, call transferOwnership of the Asset. If else, split the asset.
        if (units == carbonAsset.units()) {
            assetToBeSold.transferOwnership(address(this), _purchasersAddress);
        }
        else {
            // Call splitAsset on the UTXO asset
            address newCarbonAsset = carbonAsset.splitAsset(address(this), units, _purchasersAddress);

            // Point this sale to the new asset
            assetToBeSold = Asset(newCarbonAsset); 
        }  
    }
}
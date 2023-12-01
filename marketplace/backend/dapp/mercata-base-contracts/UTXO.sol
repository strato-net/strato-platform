pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

abstract contract UTXOAsset is Asset {
    uint public quantity;

    event AssetSplit(address newAsset, uint unitsMoved);

    constructor(
        string _name,
        string _description,
        string[] _images,
        uint _createdDate,
        uint _quantity
    ) Asset (_name, _description, _images, _createdDate){
        quantity = _quantity;
    }
    
    function splitAsset(address saleContract, uint splitUnits, address newOwner) public requireOwner("split asset") virtual returns (address) {}
}

abstract contract UTXOSale is Sale {
    uint public quantity;

    constructor(address _assetToBeSold, PaymentType _payment, uint _price, uint _quantity) Sale(_assetToBeSold, _price, _payment){
        quantity=_quantity;
    }

    function changeSaleQuantity(uint _quantity) public requireSeller("change unit quantity") {
        quantity=_quantity;
    }

    function transferOwnership(address _purchasersAddress, uint _orderId) public requireSeller("transfer ownership of Asset") override returns (uint) {
        saleOrderID = _orderId;
        executeUTXOSale(_purchasersAddress);
        state = SaleState.Closed;
        return RestStatus.OK;
    }

    function executeUTXOSale(address _purchasersAddress) public requireSeller("execute UTXO sale") {
        // Before executing the sale, ensure the asset is a UTXO asset
        UTXOAsset utxoAsset = UTXOAsset(address(assetToBeSold));

        // If the sale is for all the base units, call transferOwnership of the Asset. If else, split the asset.
        if (quantity == utxoAsset.quantity()) {
            assetToBeSold.transferOwnership(address(this), _purchasersAddress);
        }
        else {
            // Call splitAsset on the UTXO asset
            address newutxoAsset = utxoAsset.splitAsset(address(this), quantity, _purchasersAddress);

            // Point this sale to the new asset
            assetToBeSold = Asset(newutxoAsset); 
        }  
    }
}

contract UTXO{}
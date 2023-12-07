pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of asset sale contract
abstract contract SemiFungibleSale is Sale{
    uint public units;
    address[] public newSemiFungibleAssets;

    constructor(address _assetToBeSold, PaymentType _payment, uint _price, uint _units) Sale(_assetToBeSold, _price, _payment){
        units=_units;
    }

    function changeSaleQuantity(uint _units) public {
        units = _units;
    }

    function transferOwnership(address _purchasersAddress, uint _orderId) public override returns (uint) {
        saleOrderID = _orderId;
        executeSemiFungibleSale(_purchasersAddress);
        state = SaleState.Closed;
        return RestStatus.OK;
    }

    function executeSemiFungibleSale(address _purchasersAddress) public {
        // Before executing the sale, ensure the asset is a UTXO asset
        SemiFungible semiFungibleAsset = SemiFungible(address(assetToBeSold));
        newSemiFungibleAssets = semiFungibleAsset.splitAsset(msg.sender, units, _purchasersAddress);
          
    }

    // function lockUnits(uint unitsToLock) public {
    //     SemiFungible(assetToBeSold).lockUnits(msg.sender, unitsToLock);
    // }

    // function unlockUnits() public {
    //     SemiFungible(assetToBeSold).unlockUnits(msg.sender);
    // }
}
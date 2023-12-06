pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of asset sale contract
contract CarbonDAOSale is Sale{
    uint[] public units;
    address[] public newMembershipAssets;

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
        Membership membershipAsset = Membership(address(assetToBeSold));
        address newMembershipAssets[] = membershipAsset.splitAsset(address(this), units, _purchasersAddress);
        
        }  
    }
}
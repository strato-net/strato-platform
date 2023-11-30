pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of asset sale contract
contract MembershipSale is Sale{
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

    function executeUTXOSale(address _purchasersAddress, uint[] ) public requireSeller("execute UTXO sale") {

            // Iterate over the units and create a new Membership instance for each unit
            for (uint i = 0; i < units; i++) {//loop 10 times
                // Call splitAsset on the UTXO asset for each unit
                address newMembershipAssetAddress = membershipAsset.splitAsset(address(this), 1, _purchasersAddress);

                // Create a new instance of Membership with a quantity of 1
                Membership newMembershipAsset = new Membership(newMembershipAssetAddress);
                newMembershipAsset.setQuantity(1);

            }

            // Update the original asset's units
            membershipAsset.setUnits(membershipAsset.units() - units); 
    }
}
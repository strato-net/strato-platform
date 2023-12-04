pragma es6;
pragma strict;
import <afa8348e8e0305b2ac801b0ea20790bd7b638554>;

/// @title A representation of asset sale contract
contract CarbonSale is UTXOSale {
    constructor (
        address _assetToBeSold,
        PaymentType _payment,
        uint _price
    ) UTXOSale(_assetToBeSold, _payment, _price) {
    }

    // function changeSaleQuantity(uint _units) public requireSeller("change unit quantity") {
    //     units = _units;
    // }
}
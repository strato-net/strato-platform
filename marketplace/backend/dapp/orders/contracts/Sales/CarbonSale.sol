pragma es6;
pragma strict;
import <e206b22155d4958e9133fedb39dad88f0402df2d>;

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
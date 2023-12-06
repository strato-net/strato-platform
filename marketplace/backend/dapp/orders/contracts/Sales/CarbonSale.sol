pragma es6;
pragma strict;
import <0e5223240c46b3022a73c5e589536d3781e5b93f>;

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
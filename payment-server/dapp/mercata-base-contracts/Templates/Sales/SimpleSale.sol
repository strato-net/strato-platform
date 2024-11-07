pragma es6;
pragma strict;


import <3c7025100519c985573fe8cdb7a42ee27788abd9>;

/// @title A representation of asset sale contract
contract SimpleSale is Sale {
    constructor(
        address _assetToBeSold,
        decimal _price,
        uint _quantity,
        PaymentService[] _paymentServices
    ) Sale(_assetToBeSold, _price, _quantity, _paymentServices) {
    }
}

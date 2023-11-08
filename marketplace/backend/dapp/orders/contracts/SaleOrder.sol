pragma es6;
pragma strict;
import <d816194227e1a7a780fff236a449604afeb36255>;

contract SaleOrder is Order {

    constructor(
        address[] _saleAddresses,
        string _sellerCommonName,
        string _purchasersCommonName,
        address _purchasersAddress
    ) external Order(_saleAddresses, _sellerCommonName, _purchasersCommonName, _purchasersAddress){

    }

}
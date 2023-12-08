pragma es6;
pragma strict;
import <0b469dbb1f0207a49cb014192ab05a72f5b2fcf3>;

/// @title A representation of asset sale contract
contract MembershipSale is SemiFungibleSale{
    constructor(address _assetToBeSold, PaymentType _payment, uint _price, uint _units) SemiFungibleSale(_assetToBeSold, _payment, _price, _units){}
}
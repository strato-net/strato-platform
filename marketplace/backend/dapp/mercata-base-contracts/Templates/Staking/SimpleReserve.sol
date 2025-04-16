pragma es6;
pragma strict;

import <cbe1614a16d9c75447f40ede6b711e0bb996536b>;

contract SimpleReserve is Reserve{
    constructor(
        address _assetOracle, 
        string _name, 
        address _assetRootAddress, 
        decimal _unitConversionRate,
        address _usdstToken,
        decimal _usdstPrice,
        decimal _stratsPrice
        ) Reserve (_assetOracle, _name, _assetRootAddress, _unitConversionRate, _usdstToken, _usdstPrice, _stratsPrice) public {
    }
}
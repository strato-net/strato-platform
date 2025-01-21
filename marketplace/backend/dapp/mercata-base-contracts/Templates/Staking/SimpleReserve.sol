pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract SimpleReserve is Tokens, Reserve{
    constructor(
        address _assetOracle, 
        string _name, 
        address _assetRootAddress, 
        address _usdstTokenFactory,
        decimal _unitConversionRate) Reserve (_assetOracle, _name, _assetRootAddress, _unitConversionRate, _usdstTokenFactory) public {
    }
}
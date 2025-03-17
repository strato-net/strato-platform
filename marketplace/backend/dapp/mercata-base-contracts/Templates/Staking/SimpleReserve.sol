pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract SimpleReserve is Reserve{
    constructor(
        address _assetOracle, 
        string _name, 
        address _assetRootAddress, 
        decimal _unitConversionRate,
        uint _interestOnLoan,
        address _usdstToken,
        decimal _usdstPrice,
        decimal _stratsPrice
        ) Reserve (_assetOracle, _name, _assetRootAddress, _unitConversionRate, _interestOnLoan, _usdstToken, _usdstPrice, _stratsPrice) public {
    }
}
pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract SimpleReserve is Reserve{

    constructor(address _assetOracle, address _cataToken, string _name, address _assetRootAddress) Reserve (_assetOracle, _cataToken, _name, _assetRootAddress){
    }
}
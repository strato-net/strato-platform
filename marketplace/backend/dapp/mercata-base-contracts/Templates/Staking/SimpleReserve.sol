pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract SimpleReserve is Reserve{

    constructor(address _assetOracle, string _name, address _assetRootAddress) Reserve (_assetOracle, _name, _assetRootAddress){
    }
}
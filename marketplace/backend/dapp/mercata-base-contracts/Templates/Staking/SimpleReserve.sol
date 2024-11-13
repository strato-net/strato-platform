pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract SimpleReserve is Reserve{

    constructor(address _assetOracle, address _cataToken, address _owner) Reserve (_assetOracle, _cataToken, _owner){
    }
}
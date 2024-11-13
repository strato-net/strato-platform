pragma es6;
pragma strict;

import <db8c36e0e8c136afc1d3e4417dc1940f952aafd7>;

contract SimpleReserve is Reserve{

    constructor(address _assetOracle, address _stratsToken, address _cataToken, address _owner) Reserve (_assetOracle, _stratsToken, _cataToken, _owner){
        oracle = OracleService(_assetOracle);
        stratsToken = STRATSTokens(_stratsToken);
        cataToken = _cataToken;
        owner = _owner;
    }
}
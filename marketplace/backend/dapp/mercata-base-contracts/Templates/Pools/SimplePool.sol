pragma es6;
pragma strict;

import <BASE_CODE_COLLECTION>;

contract SimplePool is Pool {
    constructor(address tokenAddr, address stablecoinAddr) Pool(tokenAddr, stablecoinAddr) {}
}   
pragma es6;
pragma strict;

contract SimplePool is Pool {
    constructor(address tokenAddr, address stablecoinAddr) Pool(tokenAddr, stablecoinAddr) {}
}   
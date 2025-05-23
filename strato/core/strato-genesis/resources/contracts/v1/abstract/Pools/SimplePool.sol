pragma es6;
pragma strict;

contract SimplePool is Pool {
    constructor(address tokenAAddr, address tokenBAddr) Pool(tokenAAddr, tokenBAddr) {}
}   
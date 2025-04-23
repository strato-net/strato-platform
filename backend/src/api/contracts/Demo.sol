
pragma es6;
pragma strict;

import <5237e621b327aa06736c701383dfc969a4957376>;

/// @title A representation of Demo assets
contract Demo is Token{

    constructor(
        string _name,
        string _symbol,
        uint _createdDate,
        uint256 _initialSupply,
        uint8 _decimals
    ) Token (
        _name,
        "",
        [],
        [],
        [],
        _createdDate,
        _symbol,    
        _initialSupply,
        _decimals,
        address(0)
        ) 
    {
    }

}
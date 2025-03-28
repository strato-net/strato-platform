pragma es6;
pragma strict;

import <5c378a123236dcab013bd1df10d0043e357a4aa4>;

contract ERC20Simple is ERC20{
    address public owner;
    constructor(string name_, string symbol_, uint256 initialSupply_) ERC20(name_, symbol_){
        owner = msg.sender;
        _mint(msg.sender, initialSupply_);
    }

    function mint(uint256 amount) public{
        require(msg.sender == owner, "Only the owner can mint");
        _mint(msg.sender, amount);
    }

    function burn(uint256 amount)public {
        require(msg.sender == owner, "Only the owner can burn");
        _burn(msg.sender, amount);
    }
}
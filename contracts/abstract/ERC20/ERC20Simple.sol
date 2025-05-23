pragma es6;
pragma strict;

import <db9c5aee50c5a9044f7d22f888c89f63e21bea51>;

contract ERC20Simple is ERC20{
    address public owner;

    uint public decimals;

    constructor(string _name, string _symbol, uint256 _initialSupply, uint _decimals) ERC20(_name, _symbol){
        owner = msg.sender;
        decimals = _decimals;
        _mint(msg.sender, _initialSupply);
    }

    function decimals() public view virtual override returns (uint) {
        return decimals;
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
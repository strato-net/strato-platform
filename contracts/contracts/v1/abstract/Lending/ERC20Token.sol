pragma es6;
pragma strict;

import <509>;
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

import "../ERC20/extensions/ERC20Burnable.sol";
import "../ERC20/access/Ownable.sol";

abstract contract ERC20Token is Utils, ERC20, ERC20Burnable, Ownable {
    string public ownerCommonName;
    uint8 public decimals;
   
    constructor(
        string _name,
        string _description,
        uint _createdDate,
        string _symbol,
        uint256 _initialSupply,
        uint8 _decimals
     ) ERC20(_name, _symbol) Ownable() {
        ownerCommonName = getCommonName(msg.sender);
        decimals = _decimals;
        mint(_initialSupply);
     }

    function mint(uint256 amount) public onlyOwner {
        _mint(_owner, amount);
    }

}
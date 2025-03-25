pragma es6;
pragma strict;

import <509>;
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

import "../ERC20/extensions/ERC20Burnable.sol";
import "../ERC20/access/Ownable.sol";

abstract contract Asset is Utils, ERC20, ERC20Burnable, Ownable {
    string public ownerCommonName;
    uint8 public decimals;
    constructor(
        string _name,
        string _symbol,
        uint256 _initialSupply,
        uint8 _decimals
    ) ERC20(_name, _symbol){
        ownerCommonName = getCommonName(msg.sender);
        decimals = _decimals;
        mint(_initialSupply);
    }
    function decimals() public view virtual override returns (uint8) {
        return decimals;
    }

    function mint( uint256 amount) public onlyOwner {
        _mint(owner(), amount);
    }

}
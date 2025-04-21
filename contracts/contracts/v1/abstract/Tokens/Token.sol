pragma es6;
pragma strict;

import <509>;
import "../Enums/RestStatus.sol";
import "../Utils/Utils.sol";

import "../ERC20/extensions/ERC20Burnable.sol";
import "../ERC20/access/Ownable.sol";
import "./Metadata/TokenMetadata.sol";

abstract contract Token is Utils, ERC20, ERC20Burnable, Ownable, TokenMetadata{
    string public ownerCommonName;
    uint8 public decimals;

    TokenMetadata metadata;
    
    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        string _symbol,
        uint256 _initialSupply,
        uint8 _decimals,
        address _metadataContract
    ) ERC20(_name, _symbol){
        ownerCommonName = getCommonName(msg.sender);
        decimals = _decimals;
        mint(_initialSupply);

        metadata = TokenMetadata(_metadataContract);
        metadata.registerMetadata(address(this), _name, _description, _images, _files, _fileNames, _createdDate);
    }

    function mint(uint256 amount) public onlyOwner {
        _mint(owner, amount);
    }

}
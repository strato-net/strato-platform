import "../ERC20/access/Ownable.sol";
import "./Metadata/TokenMetadata.sol";
import "./TokenAccess.sol";
import "../ERC20/ERC20.sol";

contract record Token is ERC20, Ownable, TokenMetadata, TokenAccess{
    uint8 public customDecimals;
    
    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        string _symbol,
        uint256 _initialSupply,
        uint8 _customDecimals
    ) ERC20(_name, _symbol) TokenMetadata(_description, _images, _files, _fileNames) TokenAccess(msg.sender) Ownable(){
        customDecimals = _customDecimals;
        mint(msg.sender, _initialSupply);
    }

    function mint(address to, uint256 amount) public {
        require(
            TokenAccess(this).isMinter(msg.sender), 
            "Token: Caller is not a minter"
        );
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public {
        require(
            TokenAccess(this).isBurner(msg.sender),
            "Token: Caller is not a burner"
        );
        _burn(from, amount);
    }

    function setMetadata (
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames
    ) public onlyOwner {
        _setMetadata(_description, _images, _files, _fileNames);
    }

    function setAttribute(string key, string value) public onlyOwner {
        _setAttribute(key, value);
    }
    
    function decimals() public view virtual override returns (uint8) {
        return customDecimals;
    }

}
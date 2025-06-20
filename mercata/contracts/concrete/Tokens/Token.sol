import "../../abstract/ERC20/access/Ownable.sol";
import "./TokenMetadata.sol";
import "./TokenAccess.sol";
import "../../abstract/ERC20.sol";

enum TokenStatus { NULL, PENDING, ACTIVE, LEGACY }

contract record Token is ERC20, Ownable, TokenMetadata, TokenAccess {
    uint8 public customDecimals;
    TokenStatus public status;
    TokenFactory public tokenFactory;
    
    event StatusChanged(TokenStatus oldStatus, TokenStatus newStatus);
    
    modifier onlyTokenFactory() {
        require(msg.sender == address(tokenFactory), "Token: caller is not token factory");
        _;
    }
    
    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        string _symbol,
        uint256 _initialSupply,
        uint8 _customDecimals,
        address _tokenCreator
    ) ERC20(_name, _symbol) TokenMetadata(_description, _images, _files, _fileNames) TokenAccess(_tokenCreator) Ownable(_tokenCreator) {
        customDecimals = _customDecimals;
        status = TokenStatus.PENDING;
        tokenFactory = TokenFactory(msg.sender);
        _mint(_tokenCreator, _initialSupply);
    }

    function setStatus(uint newStatus) external onlyTokenFactory {
        require(newStatus != uint(status), "Token: New status is the same as the current status");
        require(newStatus != uint(TokenStatus.NULL), "Token: New status is NULL");
        TokenStatus _newStatus = TokenStatus(newStatus);
        emit StatusChanged(status, _newStatus);
        status = _newStatus;
    }

    function setTokenFactory(address _tokenFactory) external onlyTokenFactory {
        tokenFactory = TokenFactory(_tokenFactory);
    }

    function mint(address to, uint256 amount) external {
        require(
            TokenAccess(this).isMinter(msg.sender), 
            "Token: Caller is not a minter"
        );
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
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
    ) external onlyOwner {
        _setMetadata(_description, _images, _files, _fileNames);
    }

    function setAttribute(string key, string value) external onlyOwner {
        _setAttribute(key, value);
    }
    
    function decimals() external view virtual override returns (uint8) {
        return customDecimals;
    }
}
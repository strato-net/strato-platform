contract record Token is Utils, ERC20, Ownable, TokenMetadata, TokenAccess{
    string public ownerCommonName;
    uint8 private customDecimals;

    TokenMetadata metadata;
    TokenAccess tokenAccess;
    
    constructor(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint _createdDate,
        string _symbol,
        uint256 _initialSupply,
        uint8 _customDecimals,
        address _metadataContract,
        address _tokenAccessContract
    ) ERC20(_name, _symbol){
        ownerCommonName = getCommonName(msg.sender);
        customDecimals = _customDecimals;
        mint(msg.sender, _initialSupply);

        metadata = TokenMetadata(_metadataContract);
        metadata.registerMetadata(address(this), _name, _description, _images, _files, _fileNames, _createdDate);
        tokenAccess = TokenAccess(_tokenAccessContract);
    }

    //function mint(uint256 amount) public onlyOwner {
    //    _mint(owner, amount);
    //}

    function mint(address to, uint256 amount) public {
        require(
            tokenAccess.isMinter(msg.sender), 
            "Token: Caller is not a minter"
        );
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public {
        require(
            tokenAccess.isBurner(msg.sender),
            "Token: Caller is not a burner"
        );
        _burn(from, amount);
    }
    
    function decimals() public view virtual override returns (uint8) {
        return customDecimals;
    }

}
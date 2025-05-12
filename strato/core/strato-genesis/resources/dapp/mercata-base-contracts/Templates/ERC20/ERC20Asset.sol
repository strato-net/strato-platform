contract ERC20Asset is Asset {

    constructor(
        string _name,
        string _symbol,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint256 _initialSupply
    ) Asset(
        _name,
        _symbol,
        _description,
        _images,
        _files,
        _fileNames,
        block.timestamp,
        AssetStatus.ACTIVE
    ) {
        _mint(msg.sender, _initialSupply);
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - the caller must have a balance of at least `value`.
     */
    function transfer(address to, uint256 value) public virtual override returns (bool) {
        address owner = _msgSender();
        _transfer(owner, to, value);
        return true;
    }

    function mint(uint256 amount) public{
        require(msg.sender == owner(), "Only the owner can mint");
        _mint(msg.sender, amount);
    }

    function burn(uint256 amount)public {
        require(msg.sender == owner(), "Only the owner can burn");
        _burn(msg.sender, amount);
    }
}
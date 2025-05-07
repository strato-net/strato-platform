pragma es6;
pragma strict;

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
        _initialSupply,
        18,
        AssetStatus.ACTIVE
    ) {
        _mint(msg.sender, _initialSupply);
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
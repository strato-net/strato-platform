pragma es6;
pragma strict;

contract ERC20Asset is ERC20{
    address public owner;
    string public description;
    string[] public images;
    string[] public files;
    string[] public fileNames;

    constructor(
        string _name,
        string _symbol,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        uint256 _initialSupply
    ) ERC20(_name, _symbol){
        owner = msg.sender;
        description = _description;
        images = _images;
        files = _files; 
        fileNames = _fileNames;
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
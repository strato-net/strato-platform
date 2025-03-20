pragma solidvm 11.5;

import <509>;

import "../Utils/Utils.sol";

abstract contract MinterAuthorization is Utils {
    string public name;
    address public owner;
    bool public isActive;

    address public burnerAddress = address(0x6ec8bbe4a5b87be18d443408df43a45e5972fa1b); // burner account

    mapping(address => bool) public record canMint;

    event MintedToken(address indexed user, uint amount);
    event BurnedToken(address indexed user, uint amount);
    
    constructor(string _name) {
        owner = msg.sender;
        isActive = true;
        name = _name;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only the owner can call this function");
        _;
    }

    modifier requireActive() {
        require(isActive, "MinterAuthorization is not active");
        _;
    }

    function addReserveAsMinter() public {
        require(Reserve(msg.sender).owner() == owner, "Only owner can add entities as minters");
        canMint[msg.sender] = true;
    }

    function removeReserveAsMinter() public {
        require(Reserve(msg.sender).owner() == owner, "Only owner can remove entities as minters");
        delete canMint[msg.sender];
    }

    function mintToken(address _userAddress, uint _amount) public requireActive() {
        require(canMint[msg.sender], "Only minters can mint tokens");
        require(_amount > 0, "Must mint some tokens");
        _mint(_userAddress, _amount);
        LendingToken(address(this)).transferByReserve(_userAddress, _amount);

        emit MintedToken(_userAddress, _amount);
    }

    function burnToken(
        address[] _tokenAddresses,
        uint _quantity,
        string _ownerCommonName
    ) requireActive() public returns (uint) {
        require(canMint[msg.sender], "Only minters can mint tokens");
        require(_tokenAddresses.length > 0, "Pass at least one token address");
        _burn(msg.sender, _quantity);
        emit BurnedToken(msg.sender, _quantity);

        return tokenAmountRepaid;
    }

    function setOwner(address _newOwner) public onlyOwner{
        owner = _newOwner;
    }

    function setBurnerAddress(address _newBurnerAddress) public onlyOwner {
        burnerAddress = _newBurnerAddress;
    }

    function isReserveMinter(address _reserve) public view returns (bool) {
        return canMint[_reserve];
    }

}
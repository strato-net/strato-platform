// SPDX-License-Identifier: MIT
import "../marketplace/backend/dapp/items/contracts/Tokens.sol";

contract MercataETHBridge is Tokens{
    address private _owner;
    bool private _paused;
    mapping(address => uint256) private _reentrancyStatus;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    Tokens public ethSt;
    string[] public transferHashes;
    mapping(string => bool) private hashExists;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address account);
    event Unpaused(address account);
    event ETHBridgeHashAdded(string hash);
    event MintedETHST(address user, string username, uint256 amount);

    modifier onlyOwner() {
        require(_owner == msg.sender, "Ownable: caller is not the owner");
        _;
    }

    modifier whenNotPaused() {
        require(!_paused, "Pausable: contract is paused");
        _;
    }

    modifier nonReentrant() {
        require(_reentrancyStatus[msg.sender] != _ENTERED, "ReentrancyGuard: reentrant call");
        _reentrancyStatus[msg.sender] = _ENTERED;
        _;
        _reentrancyStatus[msg.sender] = _NOT_ENTERED;
    }

    constructor() {
        _owner = msg.sender;
        _paused = false;
    }

    function owner() public view returns (address) {
        return _owner;
    }

    function paused() public view returns (bool) {
        return _paused;
    }

    function pause() public onlyOwner {
        require(!_paused, "Pausable: already paused");
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() public onlyOwner {
        require(_paused, "Pausable: already unpaused");
        _paused = false;
        emit Unpaused(msg.sender);
    }

    function createEthSt() public onlyOwner {
        ethSt = new Tokens("ETHST", "ETHST", [], [] , [] , block.timestamp, 1, AssetStatus.ACTIVE, address(0));
    }

    mapping(address => uint256) public balances;

    function mintETHST(address userAddress, uint256 amount, string memory txHash) public onlyOwner nonReentrant {
        require(amount > 0, "Must mint some ETHST");
        require(!hashExists[txHash], "Hash already exists");
        
        hashExists[txHash] = true;
        transferHashes.push(txHash);
        balances[userAddress] += amount;
        Mintable(ethSt).mintNewUnits(amount);
        Asset(UTXO(Redeemable(Mintable(ethSt)))).automaticTransfer(userAddress, 0.01, amount, block.number);
        emit MintedETHST(userAddress, "User", amount);
    }

    function addHash(string memory hash) public onlyOwner returns (bool) {
        require(!hashExists[hash], "Hash already exists");
        hashExists[hash] = true;
        transferHashes.push(hash);
        emit ETHBridgeHashAdded(hash);
        return true;
    }

    function checkHashExists(string memory hash) public view returns (bool) {
        return hashExists[hash];
    }
}

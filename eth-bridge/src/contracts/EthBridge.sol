// SPDX-License-Identifier: MIT
import "../marketplace/backend/dapp/items/contracts/Tokens.sol";

contract MercataETHBridge {
    address _owner;
    bool _paused;
    mapping(address => uint256) private _reentrancyStatus;
    uint256 constant _NOT_ENTERED = 1;
    uint256 constant _ENTERED = 2;
    Tokens ethSt;
    string[] transferHashes;
    mapping(string => bool) private hashExists;

    // Bridge functionality
    mapping(address => uint256) public balances;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address account);
    event Unpaused(address account);
    event ETHBridgeHashAdded(string hash);

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
        ethSt = new Tokens("ETHST", "ETHST", [], [], [], 0, 0, AssetStatus.ACTIVE, address(0));
    }

    function mintETHST(address userAddress, uint256 amount, string txHash) public onlyOwner nonReentrant {
        require(amount > 0, "Must mint some WETH");
        require(!checkHashExists(txHash), "Hash already exists");
        addHash(txHash);
        balances[userAddress] += amount;
        newETHST = ethSt.mint(amount);
        newETHST.transferOwnership(userCommonName);
        emit Minted(userAddress, amount);
    }

    function addHash(string memory hash) public onlyOwner returns (bool) {
        require(!hashExists[hash], "Hash already exists");
        hashExists[hash] = true;
        transferHashes.push(hash);
        emit ETHBridgeHashAdded(hash);
        return true;
    }

    function checkHashExists(string hash) public view returns (bool) {
        return hashExists[hash];
    }
}
abstract contract MercataETHBridge{
    enum AssetStatus {
        NULL,
        ACTIVE,
        PENDING_REDEMPTION,
        RETIRED,
        MAX
    }

    address public owner;
    bool public isActive = true;

    address public ethSt;

    mapping(string => uint) public hashExists;

    event ETHBridgeHashAdded(address userAddress, string txhash, string amount);
    event MintedETHST(address user, string username, uint amount);

    modifier onlyOwner() {
        require(owner == msg.sender, "Ownable: caller is not the owner");
        _;
    }

    modifier requireActive() {
        require(isActive, "MercataETHBridge is not active");
        _;
    }
    constructor() {
        owner = msg.sender;
    }

    function deactivate() public onlyOwner requireActive {
        isActive = false;
    }

    function activate() public onlyOwner {
        require(!isActive, "Cannot activate when active");
        isActive = true;
    }

    function mintETHST(address _userAddress, uint _amount, string _txHash) external onlyOwner requireActive {
        require(_amount > 0, "Must mint some ETHST");
        require(hashExists[_txHash] == 1, "Hash doesn't exists");
        hashExists[_txHash] = 2;
        Mintable(ethSt).mintNewUnits(_amount);
        Asset(UTXO(Redeemable(Mintable(ethSt)))).automaticTransfer(_userAddress, 0.01, _amount, block.number);
        emit MintedETHST(_userAddress, "User", _amount);
    }

    function addHash(address _userAddress, string _txHash, string _amount) external requireActive {
        require(hashExists[_txHash] == 0, "Hash already exists");
        hashExists[_txHash] = 1;
        emit ETHBridgeHashAdded(_userAddress, _txHash, _amount);
    }
}
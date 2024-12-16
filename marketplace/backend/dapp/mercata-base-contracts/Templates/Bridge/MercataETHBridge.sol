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

    mapping(string => bool) public hashExists;

    event ETHBridgeHashAdded(address userAddress, string txhash, string amount);
    event MintedETHST(address user, string username, uint256 amount);

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

    function mintETHST(address userAddress, uint256 amount, string txHash) external onlyOwner requireActive {
        require(amount > 0, "Must mint some ETHST");
        require(!hashExists[txHash], "Hash already exists");

        Mintable(ethSt).mintNewUnits(amount);
        Asset(UTXO(Redeemable(Mintable(ethSt)))).automaticTransfer(userAddress, 0.01, amount, block.number);
        emit MintedETHST(userAddress, "User", amount);
    }

    function addHash(address userAddress, string txHash, string amount) external requireActive returns (bool) {
        require(!hashExists[txHash], "Hash already exists");
        hashExists[txHash] = true;
        emit ETHBridgeHashAdded(userAddress, txHash, amount);
        return true;
    }
}
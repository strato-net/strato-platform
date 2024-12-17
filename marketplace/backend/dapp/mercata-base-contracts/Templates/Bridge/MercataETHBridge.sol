pragma solidvm 11.5;

import "../Utils/Utils.sol";

abstract contract MercataETHBridge is Utils {
    enum AssetStatus {
        NULL,
        ACTIVE,
        PENDING_REDEMPTION,
        RETIRED,
        MAX
    }

    address public owner;
    address public burnerAddress = address(0x6ec8bbe4a5b87be18d443408df43a45e5972fa1b); // burner account
    bool public isActive = true;

    address public ethSt;

    mapping(string => uint) public hashExists;

    event ETHBridgeHashAdded(address userAddress, string txhash, string amount);
    event MintedETHST(address user, string username, uint amount);
    event BurnedETHST(address user, string username, string baseAddress, uint amount);

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
        Asset(UTXO(Redeemable(Mintable(ethSt)))).automaticTransfer(_userAddress, 0.000000000000000001, _amount, block.number);
        emit MintedETHST(_userAddress, getCommonName(_userAddress), _amount);
    }

    function addHash(address _userAddress, string _txHash, string _amount) external requireActive {
        require(hashExists[_txHash] == 0, "Hash already exists");
        hashExists[_txHash] = 1;
        emit ETHBridgeHashAdded(_userAddress, _txHash, _amount);
    }

    function burnETHST(
        address[] _ethstAddresses,
        uint _quantity,
        string _baseAddress
    ) requireActive() external returns (uint) {
        require(_ethstAddresses.length > 0, "Pass at least one ETHST token address");
        uint ethstAmountOwed = _quantity;
        uint ethstAmountNet = ethstAmountOwed;
        uint ethstQuantity = 0;
        uint transferNumber = 0;

        for (uint j = 0; j < _ethstAddresses.length; j++) {
            address ethstAddress = _ethstAddresses[j];
            Asset ethstAsset = Asset(ethstAddress);
            require(ethstAsset.root == ethSt.root, "Asset is not an ETHST asset");
            require(ethstAsset.ownerCommonName() == getCommonName(msg.sender), "Purchaser doesn't own this ETHST asset");

            ethstQuantity = ethstAsset.quantity();
            transferNumber = (uint(string(ethstAddress), 16) + j + block.timestamp) % 1000000;

            ethstAsset.attachSale();
            if (ethstQuantity > ethstAmountNet) {
                ethstAsset.transferOwnership(burnerAddress, ethstAmountNet, false, transferNumber, 0.000000000000000001);
                ethstAsset.closeSale();
                ethstAmountNet = 0;
            } else {
                ethstAsset.transferOwnership(burnerAddress, ethstQuantity, false, transferNumber, 0.000000000000000001);
                ethstAmountNet -= ethstQuantity;
            }

            if (ethstAmountNet == 0) {
                break;
            }
        }
        // require(ethstAmountNet == 0, "Your ethstS balance is not high enough to cover the repayment."); // Allow partial repayments

        uint ethstAmountRepaid = ethstAmountOwed - ethstAmountNet;
        emit BurnedETHST(msg.sender, getCommonName(msg.sender), _baseAddress, ethstAmountRepaid);
    }
}
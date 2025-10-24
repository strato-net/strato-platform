import "../../abstract/ERC20/access/Ownable.sol";
import "./BridgeRegistry.sol";

abstract contract BridgeAdmin is BridgeRegistry, Ownable {
    address public relayer;       // off-chain orchestrator account
    bool public depositsPaused;        // independent circuit breakers
    bool public withdrawalsPaused;
    uint256 public WITHDRAWAL_ABORT_DELAY = 172800; // Users may abort a stuck withdrawal after 48 h
    address public USDST_ADDRESS = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010); // USDST token address for cross-chain minting/redeeming
    address public tokenFactory;  // single source of "active token" truth

    constructor(address _owner) Ownable(_owner) {}

    event RelayerUpdated(address oldRelayer, address newRelayer);
    event TokenFactoryUpdated(address oldFactory, address newFactory);
    event PauseToggled(bool depositsPaused, bool withdrawalsPaused);
    event USDSTAddressUpdated(address oldAddress, address newAddress);
    event AssetUpdated(uint256 externalChainId, uint256 externalDecimals, string externalName, string externalSymbol, address externalToken, uint256 maxPerWithdrawal, address stratoToken);

    modifier onlyRelayer() {
        require(msg.sender == relayer, "MB: relayer only");
        _;
    }

    modifier whenDepositsOpen() {
        require(!depositsPaused, "MB: deposits paused");
        _;
    }

    modifier whenWithdrawalsOpen() {
        require(!withdrawalsPaused, "MB: withdrawals paused");
        _;
    }

    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "MB: zero");
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    function setPause(bool _deposits, bool _withdrawals) external onlyOwner {
        depositsPaused    = _deposits;
        withdrawalsPaused = _withdrawals;
        emit PauseToggled(_deposits, _withdrawals);
    }

    function setTokenFactory(address newFactory) external onlyOwner {
        require(newFactory != address(0), "MB: zero");
        emit TokenFactoryUpdated(tokenFactory, newFactory);
        tokenFactory = newFactory;
    }

    function setUSDSTAddress(address newUSDSTAddress) external onlyOwner {
        require(newUSDSTAddress != address(0), "MB: zero USDST address");
        emit USDSTAddressUpdated(USDST_ADDRESS, newUSDSTAddress);
        USDST_ADDRESS = newUSDSTAddress;
    }

    // External chain and asset management functions (calling BridgeRegistry internals)
    function setChain(
        string memory chainName,
        address custody,
        bool enabled,
        uint256 externalChainId,
        uint256 lastProcessedBlock,
        address router
    ) external onlyOwner {
        _setChain(chainName, custody, enabled, externalChainId, lastProcessedBlock, router);
    }

    function setAsset(
        uint256 externalChainId,
        uint256 externalDecimals,
        string memory externalName,
        string memory externalSymbol,
        address externalToken,
        uint256 maxPerWithdrawal,
        address stratoToken
    ) external onlyOwner {
        _setAsset(externalChainId, externalDecimals, externalName, externalSymbol, externalToken, maxPerWithdrawal, stratoToken);
    }

    function setLastProcessedBlock(uint256 externalChainId, uint256 lastProcessedBlock) external onlyRelayer {
        _setLastProcessedBlock(externalChainId, lastProcessedBlock);
    }

    function emergencySetLastProcessedBlock(
        uint256 externalChainId, 
        uint256 lastProcessedBlock
    ) external onlyOwner {
        _emergencySetLastProcessedBlock(externalChainId, lastProcessedBlock);
    }
}
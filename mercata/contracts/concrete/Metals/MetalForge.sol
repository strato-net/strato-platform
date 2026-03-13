import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../Lending/PriceOracle.sol";
import "../Tokens/Token.sol";
import "../Admin/FeeCollector.sol";
// TODO at the end: add reentrancy protection

contract record MetalForge is Ownable {

    PriceOracle public oracle;
    address public treasurer;
    FeeCollector public feeCollector;
    Token public usdst;
    uint public WAD;

    // ====================================================
    // ====================  EVENTS  ======================
    // ====================================================

    event Initialized(address oracle, address treasurer, address feeCollector, address usdst);

    event OracleUpdated(address newOracle);
    event TreasurerUpdated(address newTreasurer);
    event FeeCollectorUpdated(address newFeeCollector);
    event UsdstUpdated(address newUsdst);

    event MetalConfigUpdated(address metalToken, bool isEnabled, uint mintCap, uint feeBps);
    event MintCapUpdated(address metalToken, uint newCap);
    event FeeBpsUpdated(address metalToken, uint newBps);
    event MetalToggled(address metalToken, bool isEnabled);

    event PayTokenUpdated(address payToken, bool isSupported);

    event MetalMinted(
        address buyer,
        address metalToken,
        address payToken,
        uint payAmount,
        uint metalAmount,
        uint metalPrice,
        uint feeAmount,
        uint totalMinted
    );

    // ====================================================
    // ===================  STORAGE  ======================
    // ====================================================

    struct MetalConfig {
        bool isEnabled;
        uint mintCap;
        uint feeBps;
    }

    mapping(address => MetalConfig) public record metalConfigs;
    mapping(address => bool) public record isSupportedPayToken;
    mapping(address => uint) public record totalMinted;


    // ====================================================
    // ================  INITIALIZATION  ==================
    // ====================================================

    constructor(address initialOwner) Ownable(initialOwner) {}

    function initialize(address _oracle, address _treasurer, address _feeCollector, address _usdst) external onlyOwner {
        require(_oracle != address(0), "MetalForge: invalid oracle address");
        require(_treasurer != address(0), "MetalForge: invalid treasurer address");
        require(_feeCollector != address(0), "MetalForge: invalid fee collector address");
        require(_usdst != address(0), "MetalForge: invalid usdst address");

        oracle = PriceOracle(_oracle);
        treasurer = _treasurer;
        feeCollector = FeeCollector(_feeCollector);
        usdst = Token(_usdst);
        WAD = 1e18;

        emit Initialized(_oracle, _treasurer, _feeCollector, _usdst);
    }

    // ====================================================
    // ===================  CORE LOGIC  ===================
    // ====================================================

    function mintMetal(
        address metalToken,
        address payToken,
        uint payAmount,
        uint minMetalOut
    ) external {
        MetalConfig metalConfig = metalConfigs[metalToken];
        require(metalConfig.isEnabled, "MetalForge: metal is disabled");
        require(isSupportedPayToken[payToken], "MetalForge: payToken is not supported");
        require(payAmount > 0, "MetalForge: zero amount");

        uint feeAmount = (payAmount * metalConfig.feeBps) / 10000;
        uint principal = payAmount - feeAmount;

        uint fundsUSD;
        if (payToken == address(usdst)) {
            fundsUSD = principal;
        } else {
            uint payPrice = oracle.getAssetPrice(payToken);
            fundsUSD = (principal * payPrice) / WAD;
        }

        uint metalPrice = oracle.getAssetPrice(metalToken);
        uint metalAmount = (fundsUSD * WAD) / metalPrice;

        require(metalAmount >= minMetalOut, "MetalForge: slippage limit exceeded");
        require(totalMinted[metalToken] + metalAmount <= metalConfig.mintCap, "MetalForge: mintCap exceeded");

        totalMinted[metalToken] += metalAmount;

        IERC20(payToken).transferFrom(msg.sender, treasurer, principal);
        IERC20(payToken).transferFrom(msg.sender, address(feeCollector), feeAmount);
        Token(metalToken).mint(msg.sender, metalAmount);

        emit MetalMinted(
            msg.sender,
            metalToken,
            payToken,
            payAmount,
            metalAmount,
            metalPrice,
            feeAmount,
            totalMinted[metalToken]
        );
    }

    // =================================================
    // ================ ADMIN FUNCTIONS ================
    // =================================================

    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "MetalForge: invalid oracle address");
        oracle = PriceOracle(_oracle);
        emit OracleUpdated(_oracle);
    }

    function setTreasurer(address _treasurer) external onlyOwner {
        require(_treasurer != address(0), "MetalForge: invalid treasurer address");
        treasurer = _treasurer;
        emit TreasurerUpdated(_treasurer);
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "MetalForge: invalid fee collector address");
        feeCollector = FeeCollector(_feeCollector);
        emit FeeCollectorUpdated(_feeCollector);
    }

    function setUsdst(address _usdst) external onlyOwner {
        require(_usdst != address(0), "MetalForge: invalid usdst address");
        usdst = Token(_usdst);
        emit UsdstUpdated(_usdst);
    }

    function setMetalConfig(
        address _metalToken,
        bool _isEnabled,
        uint _mintCap,
        uint _feeBps
    ) external onlyOwner {
        metalConfigs[_metalToken].isEnabled = _isEnabled;
        metalConfigs[_metalToken].mintCap = _mintCap;
        metalConfigs[_metalToken].feeBps = _feeBps;
        emit MetalConfigUpdated(_metalToken, _isEnabled, _mintCap, _feeBps);
    }

    function setPayToken(address _payToken, bool _isSupported) external onlyOwner {
        isSupportedPayToken[_payToken] = _isSupported;
        emit PayTokenUpdated(_payToken, _isSupported);
    }

    function setMintCap(address _metalToken, uint _mintCap) external onlyOwner {
        metalConfigs[_metalToken].mintCap = _mintCap;
        emit MintCapUpdated(_metalToken, _mintCap);
    }

    function setFeeBps(address _metalToken, uint _feeBps) external onlyOwner {
        metalConfigs[_metalToken].feeBps = _feeBps;
        emit FeeBpsUpdated(_metalToken, _feeBps);
    }

    function setMetalEnabled(address _metalToken, bool _isEnabled) external onlyOwner {
        metalConfigs[_metalToken].isEnabled = _isEnabled;
        emit MetalToggled(_metalToken, _isEnabled);
    }


}
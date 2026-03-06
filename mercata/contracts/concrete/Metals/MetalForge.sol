import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../Lending/PriceOracle.sol";
import "../Tokens/Token.sol";
import "../Admin/FeeCollector.sol";
import "./MetalTreasury.sol";

// TODO at the end: add reentrancy protection

contract record MetalForge is Ownable {

    PriceOracle public oracle;
    MetalTreasury public treasury;
    FeeCollector public feeCollector;
    Token public usdst;
    uint public WAD;

    // ====================================================
    // ====================  EVENTS  ======================
    // ====================================================

    event Initialized(address oracle, address treasury, address feeCollector, address usdst);

    event OracleUpdated(address newOracle);
    event TreasuryUpdated(address newTreasury);
    event FeeCollectorUpdated(address newFeeCollector);
    event UsdstUpdated(address newUsdst);

    event MetalConfigUpdated(address metalToken, bool isEnabled, uint mintCap);
    event MintCapUpdated(address metalToken, uint newCap);
    event MetalToggled(address metalToken, bool isEnabled);

    event PayTokenConfigUpdated(address payToken, bool isEnabled, uint feeBps);
    event FeeBpsUpdated(address payToken, uint newBps);
    event PayTokenToggled(address payToken, bool isEnabled);

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
    }

    struct PayTokenConfig {
        bool isEnabled;
        uint feeBps;
    }

    mapping(address => MetalConfig) public record metalConfigs;
    mapping(address => PayTokenConfig) public record payTokenConfigs;
    mapping(address => uint) public record totalMinted;


    // ====================================================
    // ================  INITIALIZATION  ==================
    // ====================================================

    constructor(address _owner) Ownable(_owner) {}

    function initialize(address _oracle, address _treasury, address _feeCollector, address _usdst) external onlyOwner {
        require(_oracle != address(0), "MetalForge: invalid oracle address");
        require(_treasury != address(0), "MetalForge: invalid treasury address");
        require(_feeCollector != address(0), "MetalForge: invalid fee collector address");
        require(_usdst != address(0), "MetalForge: invalid usdst address");

        oracle = PriceOracle(_oracle);
        treasury = MetalTreasury(_treasury);
        feeCollector = FeeCollector(_feeCollector);
        usdst = Token(_usdst);
        WAD = 1e18;

        emit Initialized(_oracle, _treasury, _feeCollector, _usdst);
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
        PayTokenConfig payTokenConfig = payTokenConfigs[payToken];
        require(metalConfig.isEnabled, "MetalForge: metal is disabled");
        require(payTokenConfig.isEnabled, "MetalForge: pay token is disabled");
        require(payAmount > 0, "MetalForge: zero amount");

        uint feeAmount = (payAmount * payTokenConfig.feeBps) / 10000;
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

        IERC20(payToken).transferFrom(msg.sender, address(treasury), principal);
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

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "MetalForge: invalid treasury address");
        treasury = MetalTreasury(_treasury);
        emit TreasuryUpdated(_treasury);
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
        uint _mintCap
    ) external onlyOwner {
        metalConfigs[_metalToken].isEnabled = _isEnabled;
        metalConfigs[_metalToken].mintCap = _mintCap;
        emit MetalConfigUpdated(_metalToken, _isEnabled, _mintCap);
    }

    function setPayTokenConfig(
        address _payToken,
        bool _isEnabled,
        uint _feeBps
    ) external onlyOwner {
        payTokenConfigs[_payToken].isEnabled = _isEnabled;
        payTokenConfigs[_payToken].feeBps = _feeBps;
        emit PayTokenConfigUpdated(_payToken, _isEnabled, _feeBps);
    }

    function setMintCap(address _metalToken, uint _mintCap) external onlyOwner {
        metalConfigs[_metalToken].mintCap = _mintCap;
        emit MintCapUpdated(_metalToken, _mintCap);
    }

    function setFeeBps(address _payToken, uint _feeBps) external onlyOwner {
        payTokenConfigs[_payToken].feeBps = _feeBps;
        emit FeeBpsUpdated(_payToken, _feeBps);
    }

    function setMetalEnabled(address _metalToken, bool _isEnabled) external onlyOwner {
        metalConfigs[_metalToken].isEnabled = _isEnabled;
        emit MetalToggled(_metalToken, _isEnabled);
    }

    function setPayTokenEnabled(address _payToken, bool _isEnabled) external onlyOwner {
        payTokenConfigs[_payToken].isEnabled = _isEnabled;
        emit PayTokenToggled(_payToken, _isEnabled);
    }

}
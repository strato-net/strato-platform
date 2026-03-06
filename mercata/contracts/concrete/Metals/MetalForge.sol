import "../../abstract/ERC20/ERC20.sol";
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

    // ====================================================
    // ====================  EVENTS  ======================
    // ====================================================

    event Initialized(address oracle, address treasury, address feeCollector, address usdst);

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

    event ConfigUpdated(
        address metalToken,
        address payToken,
        bool isPaused,
        uint feeBps,
        uint mintCap
    );

    event MintCapUpdated(
        address metalToken,
        address payToken,
        uint oldCap,
        uint newCap
    );

    // ====================================================
    // ===================  STORAGE  ======================
    // ====================================================

    struct Config {
        bool isPaused;
        uint feeBps;
        uint mintCap;
    }

    struct State {
        uint totalMinted;
    }

    mapping(address => mapping(address => Config)) public record configs;
    mapping(address => mapping(address => State)) public record states;

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
        Config config = configs[metalToken][payToken];
        require(!config.isPaused, "MetalForge: paused");
        require(payAmount > 0, "MetalForge: zero amount");

        uint feeAmount = (payAmount * config.feeBps) / 10000;
        uint principal = payAmount - feeAmount;

        uint fundsUSD;
        if (payToken == address(usdst)) {
            fundsUSD = principal;
        } else {
            uint payPrice = oracle.getAssetPrice(payToken);
            fundsUSD = (principal * payPrice) / 1e18;
        }

        uint metalPrice = oracle.getAssetPrice(metalToken);
        uint metalAmount = (fundsUSD * 1e18) / metalPrice;

        require(metalAmount >= minMetalOut, "MetalForge: slippage limit exceeded");
        require(states[metalToken][payToken].totalMinted + metalAmount <= config.mintCap, "MetalForge: mintCap exceeded");

        states[metalToken][payToken].totalMinted += metalAmount;

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
            states[metalToken][payToken].totalMinted
        );
    }

    // =================================================
    // ================ ADMIN FUNCTIONS ================
    // =================================================

    function setConfig(
        address metalToken,
        address payToken,
        bool isPaused,
        uint feeBps,
        uint mintCap
    ) external onlyOwner {
        configs[metalToken][payToken] = Config(isPaused, feeBps, mintCap);
        emit ConfigUpdated(metalToken, payToken, isPaused, feeBps, mintCap);
    }

    function setConfigBatch(
        address[] calldata metalTokens,
        address[] calldata payTokens,
        bool[] calldata isPausedArr,
        uint[] calldata feeBpsArr,
        uint[] calldata mintCapArr
    ) external onlyOwner {
        uint len = metalTokens.length;
        require(len > 0, "MetalForge: empty batch");
        require(payTokens.length == len && isPausedArr.length == len && feeBpsArr.length == len && mintCapArr.length == len, "MetalForge: array length mismatch");
        for (uint i = 0; i < len; i++) {
            configs[metalTokens[i]][payTokens[i]] = Config(isPausedArr[i], feeBpsArr[i], mintCapArr[i]);
            emit ConfigUpdated(metalTokens[i], payTokens[i], isPausedArr[i], feeBpsArr[i], mintCapArr[i]);
        }
    }

    function setOracle(
        address oracle
    ) external onlyOwner {
        require(oracle != address(0), "MetalForge: invalid oracle address");
        oracle = PriceOracle(oracle);
        emit OracleUpdated(oracle);
    }
    function setTreasury(
        address treasury
    ) external onlyOwner {
        require(treasury != address(0), "MetalForge: invalid treasury address");
        treasury = MetalTreasury(treasury);
        emit TreasuryUpdated(treasury);
    }
    function setFeeCollector(
        address feeCollector
    ) external onlyOwner {
        require(feeCollector != address(0), "MetalForge: invalid fee collector address");
        feeCollector = FeeCollector(feeCollector);
        emit FeeCollectorUpdated(feeCollector);
    }

    function setUsdst(
        address usdst
    ) external onlyOwner {
        require(usdst != address(0), "MetalForge: invalid usdst address");
        usdst = Token(usdst);
        emit UsdstUpdated(usdst);
    }

    function setMintCap(
        address metalToken,
        address payToken,
        uint mintCap
    ) external onlyOwner {
        uint oldCap = configs[metalToken][payToken].mintCap;
        configs[metalToken][payToken].mintCap = mintCap;
        emit MintCapUpdated(metalToken, payToken, oldCap, mintCap);
    }

    function setFeeBps(
        address metalToken,
        address payToken,
        uint feeBps
    ) external onlyOwner {
        configs[metalToken][payToken].feeBps = feeBps;
        emit ConfigUpdated(metalToken, payToken, configs[metalToken][payToken].isPaused, feeBps, configs[metalToken][payToken].mintCap);
    }

    function setIsPaused(
        address metalToken,
        address payToken,
        bool isPaused
    ) external onlyOwner {
        configs[metalToken][payToken].isPaused = isPaused;
        emit ConfigUpdated(metalToken, payToken, isPaused, configs[metalToken][payToken].feeBps, configs[metalToken][payToken].mintCap);
    }

}
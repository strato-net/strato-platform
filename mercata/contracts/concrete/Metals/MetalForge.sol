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

    // ====================================================
    // ====================  EVENTS  ======================
    // ====================================================

    event Initialized(address oracle, address treasury, address feeCollector);

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
        bool isStable,
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
        bool isStable;
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

    function initialize(address _oracle, address _treasury, address _feeCollector) external onlyOwner {
        require(_oracle != address(0), "MetalForge: invalid oracle");
        require(_treasury != address(0), "MetalForge: invalid treasury");
        require(_feeCollector != address(0), "MetalForge: invalid fee collector");

        oracle = PriceOracle(_oracle);
        treasury = MetalTreasury(_treasury);
        feeCollector = FeeCollector(_feeCollector);

        emit Initialized(_oracle, _treasury, _feeCollector);
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
        if (config.isStable) {
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
        bool isStable,
        uint feeBps,
        uint mintCap
    ) external onlyOwner {
        configs[metalToken][payToken] = Config(isPaused, isStable, feeBps, mintCap);
        emit ConfigUpdated(metalToken, payToken, isPaused, isStable, feeBps, mintCap);
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
        emit ConfigUpdated(metalToken, payToken, configs[metalToken][payToken].isPaused, configs[metalToken][payToken].isStable, feeBps, configs[metalToken][payToken].mintCap);
    }

    function setIsPaused(
        address metalToken,
        address payToken,
        bool isPaused
    ) external onlyOwner {
        configs[metalToken][payToken].isPaused = isPaused;
        emit ConfigUpdated(metalToken, payToken, isPaused, configs[metalToken][payToken].isStable, configs[metalToken][payToken].feeBps, configs[metalToken][payToken].mintCap);
    }

    function setIsStable(
        address metalToken,
        address payToken,
        bool isStable
    ) external onlyOwner {
        configs[metalToken][payToken].isStable = isStable;
        emit ConfigUpdated(metalToken, payToken, configs[metalToken][payToken].isPaused, isStable, configs[metalToken][payToken].feeBps, configs[metalToken][payToken].mintCap);
    }
}
import "../../abstract/ERC20/access/Ownable.sol";

contract record USDSTMintGateway is Ownable {

    /* Events */
    event DepositCompleted(bytes32 indexed depositKey, address indexed to, uint amount6, uint mintFee6);
    event RedeemRequested(uint indexed id, address indexed user, address indexed ethAsset, uint amount18, address destEthAddress);

    /* Modifiers */
    modifier onlyRelayer() {
        require(msg.sender == relayer, "GW: relayer only");
        _;
    }

    /* Constructor */
    constructor(address _relayer, address _owner) Ownable(_owner) {
        relayer = _relayer;
    }

    /* Functions */
    function mintFromDeposit(
        bytes32 depositKey,
        address ethAsset,
        address to,
        uint amount6
    ) external onlyRelayer {
        // TODO: Implement minting logic
        // Compute Gross18 / MintFee18 / NetToUser18.
        // USDST.mint(to, NetToUser18).
        // USDST.mint(FeeCollector, MintFee18).
        // Mark deposit COMPLETED, emit DepositCompleted(depositKey, to, NetToUser18, MintFee18).
    }

    function requestRedeem(address ethAsset, uint amount18, address destEthAddress, uint clientNonce) external {
        // Checks: ethAsset ∈ {USDC, USDT}, amount within per-tx limit, gateway not paused.
        // Transfers amount18 USDST from user to escrow (held by gateway).
        // Creates Redeem{ id, user, ethAsset, amount18, destEthAddress, state=REQUESTED }.
        // Emits RedeemRequested(id, user, ethAsset, amount18, destEthAddress).
    }
}
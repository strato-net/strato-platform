import "../../abstract/ERC20/access/Ownable.sol";
import "../Admin/FeeCollector.sol";
import "./MercataBridge.sol";

contract record USDSTMintGateway is Ownable {

    /* Events */
    event DepositCompleted(bytes32 indexed depositKey, address indexed to, uint amount6, uint mintFee6);
    event RedeemRequested(uint indexed id, address indexed user, address indexed ethAsset, uint amount18, address destEthAddress);

    /* State */
    address public relayer; // off-chain orchestrator account; TODO should this actually be here?
    FeeCollector public feeCollector;
    MercataBridge public bridge;

    /* Modifiers */
    modifier onlyRelayer() {
        require(msg.sender == relayer, "GW: relayer only");
        _;
    }
    modifier onlyBridge() {
        require(msg.sender == bridge, "GW: bridge only");
        _;
    }

    /* Constructor */
    constructor(address _relayer, address _bridge, address _feeCollector, address _owner) Ownable(_owner) {
        relayer = _relayer;
        bridge = MercataBridge(_bridge);
        feeCollector = FeeCollector(_feeCollector);
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
    /* Following user call to requestRedeem,
    1.) Relayer observes RedeemRequested, proposes a Safe transfer for
    payout6 = floor((amount18 - RedeemFee18) / 1e12).


    2.) Relayer calls markRedeemPending(id, safeTxHash) on the gateway (or via Bridge):
    state = PENDING_TX, emit RedeemPendingTx(id, safeTxHash, payout6).


    3.) Once Safe tx is executed, Relayer calls
    finaliseRedeem(id) → gateway:
    - Burn amount18 from escrow,
    - Mint RedeemFee18 to FeeCollector (USDST),
    - state = COMPLETED, emit RedeemFinalised(id, payout6, RedeemFee18).

    4.) *If the Safe tx fails/aborts, an authorized actor can call cancelRedeem(id) to return escrowed USDST to the user; emits RedeemCancelled.
    */

    function finalizeRedeem(uint id) external onlyRelayer {
        // TODO: Implement redeem finalization logic
        // Burn amount18 from escrow,
        // Mint RedeemFee18 to FeeCollector (USDST),
        // state = COMPLETED, emit RedeemFinalised(id, payout6, RedeemFee18).
    }

    // TODO modifier might need updated; specs say authorized actor can call cancelRedeem
    function cancelRedeem(uint id) external onlyRelayer {
        // TODO: Implement redeem cancellation logic
        // Return escrowed USDST to the user,
        // state = CANCELLED, emit RedeemCancelled(id).
    }
}
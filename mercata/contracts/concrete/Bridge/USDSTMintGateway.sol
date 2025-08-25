import "../../abstract/ERC20/access/Ownable.sol";
import "../Admin/FeeCollector.sol";
import "./MercataBridge.sol";

/**
 * Should be a minter and burner of USDST.
 */
contract record USDSTMintGateway is Ownable {

    /* Events */
    event DepositCompleted(bytes32 indexed depositKey, address indexed to, uint netToUser18, uint mintFee18);
    event RedeemRequested(uint indexed id, address indexed user, address indexed ethAsset, uint amount18, address destEthAddress);
    
    /* Errors */
    error AmountExceedsLimit();
    error RedeemNotRequested();
    error RedeemFeeTooHigh();
    error RedeemNotPending();
    error RedeemNotCompleted();
    error RedeemNotCancellable();

    /* Structs and Enums */
    struct Redeem {
        uint id;
        address user;
        address ethAsset;
        uint amount18;
        address destEthAddress;
        RedeemStatus state;
    }
    enum RedeemStatus {
        NONE,
        REQUESTED,
        PENDING_TX,
        COMPLETED,
        CANCELLED
    }

    /* State */
    // address public relayer; // off-chain orchestrator account; TODO should this actually be here?
    FeeCollector public feeCollector;
    MercataBridge public bridge;

    bool public gatewayPaused;
    mapping(address => bool) public approvedStablecoins;
    uint public perTxRedeemLimit;
    uint public redeemFeeBps;
    mapping(uint => Redeem) public redemptions;
    uint public nonce;

    /* Modifiers */
    // modifier onlyRelayer() {
    //     require(msg.sender == relayer, "GW: relayer only");
    //     _;
    // }
    modifier onlyBridge() {
        require(msg.sender == bridge, "GW: bridge only");
        _;
    }
    modifier notPaused() {
        require(!gatewayPaused, "GW: gateway is paused");
        _;
    }
    modifier onlyApprovedStablecoin(address ethAsset) {
        require(approvedStablecoins[ethAsset], "GW: not approved stablecoin");
        _;
    }

    /* Constructor */
    constructor(
        // address _relayer,
        address _bridge,
        address _feeCollector,
        address _owner,
        uint _redeemFeeBps
    ) Ownable(_owner) {
        // relayer = _relayer;
        bridge = MercataBridge(_bridge);
        feeCollector = FeeCollector(_feeCollector);

        // TODO a limit on fees might be desirable
        if (_redeemFeeBps > 10_000) revert RedeemFeeTooHigh();
        redeemFeeBps = _redeemFeeBps;
    }

    /* Internal Functions */
    function _calculateRedeemFee(uint amount18) internal view returns (uint) {
        return amount18 * redeemFeeBps / 10_000;
    }

    function _calculateMintFee(uint amount18) internal view returns (uint) {
        return amount18 * mintFeeBps / 10_000;
    }

    /* Setters */
    function setRedeemFeeBps(uint _redeemFeeBps) external onlyOwner {
        if (_redeemFeeBps > 10_000) revert RedeemFeeTooHigh();
        redeemFeeBps = _redeemFeeBps;
    }

    /* Public Functions */
    function mintFromDeposit( //TODO does some of me belong in Bridge?
        bytes32 depositKey,
        address ethAsset,
        address to,
        uint amount6
    ) external onlyBridge {
        // Compute Gross18 / MintFee18 / NetToUser18.
        uint gross18 = amount6 * 1e12;
        uint mintFee18 = _calculateMintFee(gross18);
        uint netToUser18 = gross18 - mintFee18;

        // USDST.mint(to, NetToUser18).
        IERC20(USDST).mint(to, netToUser18);

        // USDST.mint(FeeCollector, MintFee18).
        IERC20(USDST).mint(feeCollector, mintFee18);

        // Mark deposit COMPLETED, emit DepositCompleted(depositKey, to, NetToUser18, MintFee18).
        // TODO mark deposit completed - is this in bridge?
        emit DepositCompleted(depositKey, to, netToUser18, mintFee18);
    }

    function requestRedeem(
        address ethAsset,
        uint amount18,
        address destEthAddress,
        uint clientNonce
    ) external
        notPaused
        onlyApprovedStablecoin(ethAsset)
    {
        // Checks: ethAsset ∈ {USDC, USDT}, amount within per-tx limit, gateway not paused.
        if (amount18 > perTxRedeemLimit) revert AmountExceedsLimit();

        // Transfers amount18 USDST from user to escrow (held by gateway).
        IERC20(USDST).transferFrom(msg.sender, address(this), amount18); //TODO Permit? Approval?

        // Creates Redeem{ id, user, ethAsset, amount18, destEthAddress, state=REQUESTED }.
        uint id = ++nonce; //TODO is there a better way to get id?
        redemptions[id] = Redeem({
            id: id,
            user: msg.sender,
            ethAsset: ethAsset,
            amount18: amount18,
            destEthAddress: destEthAddress,
            state: RedeemStatus.REQUESTED
        });

        // Emits RedeemRequested(id, user, ethAsset, amount18, destEthAddress).
        emit RedeemRequested(id, user, ethAsset, amount18, destEthAddress);
    }

    function markRedeemPending(uint id, bytes32 safeTxHash) external onlyBridge {
        if (redemptions[id].state != RedeemStatus.REQUESTED) revert RedeemNotRequested();
        redemptions[id].state = RedeemStatus.PENDING_TX;
        uint redeemFee18 = _calculateRedeemFee(redemptions[id].amount18);
        uint payout6 = (redemptions[id].amount18 - redeemFee18) / 1e12; // TODO we might want to impl differently; see comment on doc
        // TODO at which stage should we extract fees? maybe amount18 should already be less fees
        emit RedeemPendingTx(id, safeTxHash, payout6);
    }

    function finalizeRedeem(uint id) external onlyBridge {
        // Handle State Machine
        if (redemptions[id].state != RedeemStatus.PENDING_TX) revert RedeemNotPending();

        // Burn amount18 from escrow
        uint amount18 = redemptions[id].amount18;
        IERC20(USDST).burn(address(this), amount18); // 🚨 be careful

        // Mint RedeemFee18 to FeeCollector (USDST)
        uint redeemFee18 = _calculateRedeemFee(amount18);
        uint payout6 = (amount18 - redeemFee18) / 1e12; // TODO recauclating this here?
        IERC20(USDST).mint(feeCollector, redeemFee18); // 🚨 be careful

        // state = COMPLETED, emit RedeemFinalised(id, payout6, RedeemFee18).
        redemptions[id].state = RedeemStatus.COMPLETED;
        emit RedeemFinalised(id, payout6, redeemFee18);
    }

    // TODO modifier might need updated; specs say authorized actor can call cancelRedeem
    function cancelRedeem(uint id) external onlyBridge {
        // Handle State Machine
        if (redemptions[id].state != RedeemStatus.REQUESTED) revert RedeemNotCancellable(); //TODO check if this is correct

        // Return escrowed USDST to the user
        IERC20(USDST).transfer(redemptions[id].user, redemptions[id].amount18);

        // state = CANCELLED, emit RedeemCancelled(id).
        redemptions[id].state = RedeemStatus.CANCELLED;
        emit RedeemCancelled(id);

        // Please be careful here, there's a lot of potential for loss of funds if the user calls cancelRedeem and the Safe tx is still executed
    }
}
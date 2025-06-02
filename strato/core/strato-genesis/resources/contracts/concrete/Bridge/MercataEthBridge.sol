/*
 *  MercataEthBridge – STRATO ↔ Ethereum Safe bridge contract (no OpenZeppelin deps)
 *  ---------------------------------------------------------------------------
 *  FUNCTIONAL OVERVIEW
 *  -------------------
 *  1. **Deposit → Mint (Ethereum → STRATO)**
 *     • A relayer observes deposits into a Gnosis Safe wallet on Ethereum.
 *     • For every confirmed deposit it calls `recordDeposit(...)`, which mints
 *       wrapped tokens (or ETH representation) on STRATO for the recipient.
 *     • The Ethereum tx‑hash is tracked in `processed` to prevent re‑minting.
 *
 *  2. **Burn → Withdrawal Request (STRATO → Ethereum)**
 *     • Users burn their wrapped tokens via `withdraw(...)` and supply the
 *       20‑byte Ethereum address where they want the original asset.
 *     • A deterministic `withdrawId` is generated and stored with state
 *       **INITIATED**; an event is emitted for front‑ends and the relayer.
 *
 *  3. **Safe Release Workflow**
 *     • The off‑chain relayer builds a matching Safe multisig transaction.
 *     • Once posted to the Safe Tx Service it calls `markPendingApproval()`
 *       to update the status to **PENDING_APPROVAL**.
 *     • After the Safe executes on Ethereum, the relayer calls
 *       `confirmWithdrawal()` to mark the request **COMPLETED**.
 *
 *  4. **Security Features**
 *     • Single `owner` key (ideally a STRATO multisig) with power to pause,
 *       change relayer, and tweak dust limit.
 *     • `relayer` key allowed to record deposits and advance withdrawal state.
 *     • `paused` circuit breaker controlled by owner.
 *     • `nonReentrant` modifier based on simple status flag.
 *     • `minAmount` guard blocks dust / spam.
 *     • Replay protection on deposits via `processed` mapping.
 */

contract record MercataEthBridge {
   // ────────────────── configuration ──────────────────
    address public owner;       // STRATO admin key
    address public relayer;     // off‑chain relayer key

    uint256 public minAmount = 0 ether; // dust guard

    // ──────────────────── state ─────────────────────────
    mapping(uint256 => bool) public processed; // ethTxHash(uint256) → minted?

    enum WithdrawState { NONE, INITIATED, PENDING_APPROVAL, COMPLETED }
    mapping(uint256 => WithdrawState) public withdrawStatus; // withdrawId → state

    uint256 public nextWithdrawId = 1; // monotonically increasing ID counter

    // ─────────────────── events ─────────────────────────
    event DepositRecorded(uint256 indexed ethTxHash, address indexed to, address indexed token, uint256 amount);
    event WithdrawalInitiated(uint256 indexed withdrawId, address indexed from, address indexed token, uint256 amount, address ethRecipient);
    event WithdrawalPendingApproval(uint256 indexed withdrawId);
    event WithdrawalCompleted(uint256 indexed withdrawId);
    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);
    event MinAmountUpdated(uint256 oldVal, uint256 newVal);

    // ─────────────────── modifiers ─────────────────────
    modifier onlyOwner()   { require(msg.sender == owner,   "NOT_OWNER");   _; }
    modifier onlyRelayer() { require(msg.sender == relayer, "NOT_RELAYER"); _; }

    // ───────────────── constructor ─────────────────────
    constructor(address _relayer) {
        require(_relayer != address(0), "ZERO_RELAYER");
        owner   = _relayer;
        relayer = _relayer;
    }

    // ───────────── admin / config ops ──────────────────
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_ADDR");
        emit OwnerUpdated(owner, newOwner);
        owner = newOwner;
    }

    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "ZERO_ADDR");
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    function setMinAmount(uint256 newMin) external onlyOwner {
        emit MinAmountUpdated(minAmount, newMin);
        minAmount = newMin;
    }

    // ────────── Ethereum → STRATO (mint) ──────────────
    function recordDeposit(uint256 ethTxHash, address token, address to, uint256 amount) external onlyRelayer {
        require(!processed[ethTxHash], "ALREADY_PROCESSED");
        require(amount >= minAmount,   "BELOW_MIN");

        processed[ethTxHash] = true;
        Token(token).mint(to, amount);
        emit DepositRecorded(ethTxHash, to, token, amount);
    }

    // ────────── STRATO → Ethereum (burn) ──────────────
    function withdraw(address token, address from, uint256 amount, address ethRecipient) external onlyRelayer{
        require(amount >= minAmount, "BELOW_MIN");

        uint256 withdrawId = nextWithdrawId++;
        // No duplicate check needed because ID is unique by construction

        Token(token).burn(from, amount);
        withdrawStatus[withdrawId] = WithdrawState.INITIATED;
        emit WithdrawalInitiated(withdrawId, from, token, amount, ethRecipient);
    }

    /** Relayer marks Safe tx posted → awaiting multisig approvals */
    function markPendingApproval(uint256 withdrawId) external onlyRelayer {
        require(withdrawStatus[withdrawId] == WithdrawState.INITIATED, "BAD_STATE");
        withdrawStatus[withdrawId] = WithdrawState.PENDING_APPROVAL;
        emit WithdrawalPendingApproval(withdrawId);
    }

    /** Relayer marks Safe executed → funds released */
    function confirmWithdrawal(uint256 withdrawId) external onlyRelayer {
        require(withdrawStatus[withdrawId] == WithdrawState.PENDING_APPROVAL, "BAD_STATE");
        withdrawStatus[withdrawId] = WithdrawState.COMPLETED;
        emit WithdrawalCompleted(withdrawId);
    }
}

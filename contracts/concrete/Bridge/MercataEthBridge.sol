import "./Tokens/Token.sol";
/*
 *  MercataEthBridge – STRATO ↔ Ethereum Safe bridge contract (no OpenZeppelin deps)
 *  ------------------------------------------------------------------------------
 *  FUNCTIONAL OVERVIEW
 *  -------------------
 *  1. **Deposit → Mint (Ethereum → STRATO)**
 *     • A relayer monitors Ethereum for deposits into a Gnosis Safe wallet.
 *     • For each verified deposit, it calls `deposit(...)`:
 *         – Marks the Ethereum txHash as **INITIATED** in `depositStatus`.
 *         – Emits `DepositInitiated`
 *     • After the relayer confirms off-chain validation, it calls `confirmDeposit(...)`:
 *         – Mints the corresponding wrapped token amount to the STRATO user.
 *         – Marks the deposit as **COMPLETED** in `depositStatus`.
 *         – Emits `DepositCompleted`.
 *     • Replays are prevented via the `depositStatus` mapping.
 *
 *  2. **Withdraw → Burn and Ethereum Payout (STRATO → Ethereum)**
 *     • A relayer initiates a withdrawal on behalf of a Mercata user by calling `withdraw(...)`:
 *         – Burns the specified amount of wrapped tokens from the STATO user
 *         – Records the withdrawal under `withdrawStatus` with state **INITIATED**.
 *         – Emits `WithdrawalInitiated`
 *     • Once the relayer constructs and submits a corresponding Safe transaction on Ethereum,
 *       it calls `markWithdrawalPendingApproval(...)`:
 *         – Updates the withdrawal status to **PENDING_APPROVAL**.
 *         – Emits `WithdrawalPendingApproval`.
 *     • After the Ethereum transaction is executed and confirmed on-chain,
 *       the relayer calls `confirmWithdrawal(...)`:
 *         – Finalizes the withdrawal by marking it as **COMPLETED**.
 *         – Emits `WithdrawalCompleted`.
 *     • Duplicate execution is prevented via `withdrawStatus`.
 *
 *  3. **Security Features**
 *     • `owner`: STRATO admin key (ideally a multisig) with authority to update relayer and `minAmount`.
 *     • `relayer`: Off-chain trusted agent that manages bridging operations and lifecycle transitions.
 *     • `minAmount`: Enforces a lower bound on transfer sizes to prevent dust/spam.
 *     • Replay protection: Enforced via `depositStatus` and `withdrawStatus` mappings keyed by `txHash`.
 */

contract record MercataEthBridge {
   // ────────────────── configuration ──────────────────
    address public owner;       // STRATO admin key
    address public relayer;     // off‑chain relayer key

    uint256 public minAmount = 0 ether; // dust guard

    // ──────────────────── state ─────────────────────────
    //mapping(uint256 => bool) public processed; // ethTxHash(uint256) → minted?

    enum WithdrawState { NONE, INITIATED, PENDING_APPROVAL, COMPLETED }
    mapping(string => WithdrawState) public withdrawStatus; 

    enum DepositState { NONE, INITIATED, COMPLETED }
    mapping(string => DepositState) public depositStatus; 

    // ─────────────────── events ─────────────────────────
    event DepositInitiated(string indexed txHash, address indexed from, address indexed token, uint256 amount, address to, address mercataUser);
    event DepositCompleted(string indexed txHash);
    event WithdrawalInitiated(string indexed txHash, address indexed from, address indexed token, uint256 amount, address to, address mercataUser);
    event WithdrawalPendingApproval(string indexed txHash);
    event WithdrawalCompleted(string indexed txHash);
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
    // txHash = Ethereum TX hash, from = depositor's Eth address, to = Safe wallet address
    // mercataUser = Mercata user address of user initiating the deposit
    // token = wrapped token
    function deposit(string calldata txHash, address token, address from, uint256 amount, address to, address mercataUser) external onlyRelayer {
        require(depositStatus[txHash] == DepositState.NONE, "ALREADY_PROCESSED");
        require(amount >= minAmount, "BELOW_MIN");

        depositStatus[txHash] = DepositState.INITIATED;
        emit DepositInitiated(txHash, from, token, amount, to, mercataUser);
    }

    function confirmDeposit(string calldata txHash, address token, address to, uint256 amount, address mercataUser) external onlyRelayer {
        require(depositStatus[txHash] == DepositState.INITIATED, "BAD_STATE");

        Token(token).mint(mercataUser, amount);
        depositStatus[txHash] = DepositState.COMPLETED;
        emit DepositCompleted(txHash);
    }
     
    // ────────── STRATO → Ethereum (burn) ──────────────
    // txHash = Safe TX hash, from = Safe wallet address, to = Eth address of recipient
    // mercataUser = Mercata user address of user initiating the withdrawal
    // token = wrapped token
    function withdraw(string calldata txHash, address token, address from, uint256 amount, address to, address mercataUser) external onlyRelayer {
        require(withdrawStatus[txHash] == WithdrawState.NONE, "ALREADY_PROCESSED");
        require(amount >= minAmount, "BELOW_MIN");

        Token(token).burn(mercataUser, amount);
        withdrawStatus[txHash] = WithdrawState.INITIATED;

        emit WithdrawalInitiated(txHash, from, token, amount, to, mercataUser);
    }

    function markWithdrawalPendingApproval(string calldata txHash) external onlyRelayer {
        require(withdrawStatus[txHash] == WithdrawState.INITIATED, "BAD_STATE");
        withdrawStatus[txHash] = WithdrawState.PENDING_APPROVAL;
        emit WithdrawalPendingApproval(txHash);
    }

    function confirmWithdrawal(string calldata txHash) external onlyRelayer {
        require(withdrawStatus[txHash] == WithdrawState.PENDING_APPROVAL, "BAD_STATE");
        withdrawStatus[txHash] = WithdrawState.COMPLETED;
        emit WithdrawalCompleted(txHash);
    }    

}

/*  ─────────────────────────────────────────────────────────────────────────
    MercataEthBridge  –  STRATO <-> External EVM value tunnel
    ------------------------------------------------------------------------
    TRUST MODEL
      • Funds on external chain live in a Gnosis Safe (multisig).
      • A single on-chain contract on STRATO books mint / burn of wrapped
        tokens; it does *not* verify Ethereum state – that’s the relayer’s job.
      • The off-chain Relayer is accountable via `onlyRelayer` and on-chain
        replay-protection keys.

    GUARANTEES
      • Canonical supply integrity (mint only once per depositKey).
      • Escrow of tokens on withdrawal until Safe executes.
      • Deterministic abort path so users are never stuck forever.
      • Owner can pause *in* or *out* legs independently.

    NON-GOALS
      • Light-client verification, trustless bridge, fast-finality.
      • Multi–asset rotation (one factory-verified token list is enough).
    ───────────────────────────────────────────────────────────────────────── */

import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/utils/ReentrancyGuard.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../Tokens/TokenFactory.sol";
import "../Tokens/Token.sol";

/* ───────────────────────────────────────────────────────────────────────── */
contract record MercataEthBridge is Ownable, ReentrancyGuard {
/* --------------------------------------------------------------------- */
/*                            ─  ENUMS  ─                               */
/* --------------------------------------------------------------------- */
/* One shared enum keeps byte-code small.  The same values are reused
   for deposits and withdrawals.                                         */
    enum BridgeStatus {
        NONE,         // default (mapping unset)
        INITIATED,    // deposit  : relayer observed external tx
                      // withdrawal: user escrowed tokens
        PENDING_SAFE, // withdrawal only – Safe tx proposed
        COMPLETED,    // flow fully executed
        ABORTED       // owner/user reclaimed escrow
    }

/* --------------------------------------------------------------------- */
/*                          ─  DATA STRUCTS ─                           */
/* --------------------------------------------------------------------- */
    struct DepositInfo {
        address token;        // STRATO token to mint
        address user;         // STRATO recipient
        uint256 amount;       // amount to mint
        BridgeStatus bridgeStatus; // NONE / INITIATED / COMPLETED / ABORTED
    }

    struct WithdrawalInfo {
        uint256 destChainId; // Chain where Safe resides
        address token;       // Token to burn
        address user;        // STRATO sender
        address dest;        // External recipient address
        uint256 amount;      // Escrowed amount
        uint64 requestedAt; // Timestamp – drives abort timeout
        BridgeStatus   bridgeStatus;      // NONE / INITIATED / PENDING_SAFE / ...
    }

    struct TokenLimit {
        uint256 maxPerTx;    // Hard ceiling; 0 means “unlimited”
    }

/* --------------------------------------------------------------------- */
/*                         ─  STORAGE  STATE ─                           */
/* --------------------------------------------------------------------- */
    /* Deposit replay-protection: key = (srcChainId, ethTxHashUint) */
    mapping(uint256 => mapping(string => DepositInfo)) public record deposits;

    /* Withdrawal key */
    mapping(uint256 => WithdrawalInfo) public record withdrawals;
    uint256 public withdrawalCounter;       // auto-increment id

    /* Per-token caps defend Safe liquidity                              */
    mapping(address => TokenLimit) public record tokenLimits;

    /* ─── chain & asset registries (on-chain catalogue) ───────────── */
    struct ChainInfo {
        address safe;          // custody Safe on that chain
        address depositRouter; // contract users interact with on L1/L2
        uint256 lastProcessedBlock;
        bool    enabled;       // quick toggle
    }
    struct AssetInfo {
        address extToken;      // token address on external chain
        uint256 extDecimals;   // decimals of extToken
        uint256 chainId;       // back-pointer to ChainInfo
        bool    enabled;       // toggle
    }

    mapping(uint256 => ChainInfo) public record chains;   
    mapping(address => AssetInfo) public record assets;   

    /* ─────────────────────────────── */

    TokenFactory public tokenFactory;  // single source of “active token” truth
    address      public relayer;       // off-chain orchestrator account

    bool public depositsPaused;        // independent circuit breakers
    bool public withdrawalsPaused;

    /* Users may abort a stuck withdrawal after 48 h                     */
    uint64 public WITHDRAWAL_ABORT_DELAY = 172800;

/* --------------------------------------------------------------------- */
/*                               EVENTS                                  */
/* --------------------------------------------------------------------- */
    /*  DEPOSIT FLOW  */
    event DepositInitiated(   // relayer observed ETH tx
        uint256 indexed srcChainId,
        string  ethTxHash,
        address token,
        uint256 amount,
        address indexed user
    );
    event DepositCompleted(uint256 indexed srcChainId, string ethTxHash);   // wrapped tokens minted

    /*  WITHDRAWAL FLOW  */
    event WithdrawalRequested(  // user locked tokens in bridge
        uint256 indexed id,
        uint256 indexed destChainId,
        address token,
        uint256 amount,
        address indexed user,
        address dest
    );
    event WithdrawalPendingSafe(uint256 indexed id, string safeTxHash);
    event WithdrawalCompleted  (uint256 indexed id, string safeTxHash);
    event WithdrawalAborted    (uint256 indexed id);

    /*  ADMIN  */
    event TokenLimitUpdated(address indexed token, uint256 maxPerTx);
    event RelayerUpdated   (address indexed oldRelayer, address indexed newRelayer);
    event PauseToggled     (bool depositsPaused, bool withdrawalsPaused);
    event ChainUpdated(uint256 indexed chainId, address safe, address router, uint256 lastProcessedBlock, bool enabled);
    event AssetUpdated(address indexed stratoToken, uint256 chainId, address extToken, uint256 extDecimals, bool enabled);

/* --------------------------------------------------------------------- */
/*                           ─  MODIFIERS  ─                             */
/* --------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------- */
/*                             CONSTRUCTOR                               */
/* --------------------------------------------------------------------- */
    constructor(address _tokenFactory, address _relayer, address _owner)
        Ownable(_owner)
    {
        require(_tokenFactory!=address(0)&&_relayer!=address(0),"MB: zero");
        tokenFactory = TokenFactory(_tokenFactory);
        relayer      = _relayer;
    }

/* ===================================================================== */
/*                        ADMIN / GUARDIAN ACTIONS                       */
/* ===================================================================== */

    /* rotate relayer key if compromised */
    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer!=address(0),"MB: zero");
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    /* independent pause toggles */
    function setPause(bool _deposits, bool _withdrawals) external onlyOwner {
        depositsPaused    = _deposits;
        withdrawalsPaused = _withdrawals;
        emit PauseToggled(_deposits, _withdrawals);
    }

    /* hard per-tx cap */
    function setTokenLimits(address token, uint256 maxPerTx)
        external
        onlyOwner
    {
        tokenLimits[token].maxPerTx = maxPerTx;
        emit TokenLimitUpdated(token, maxPerTx);
    }

    function setChain(uint256 chainId, address safe, address router, uint256 lastProcessedBlock, bool enabled) external onlyOwner {
        chains[chainId] = ChainInfo(safe, router, lastProcessedBlock, enabled);
        emit ChainUpdated(chainId, safe, router, lastProcessedBlock, enabled);
    }

    function setAsset(address stratoToken, uint256 chainId, address extToken, uint256 extDecimals, bool enabled) external onlyOwner {
        require(chains[chainId].safe != address(0), "MB: chain missing");
        assets[stratoToken] = AssetInfo(extToken, extDecimals, chainId, enabled);
        emit AssetUpdated(stratoToken, chainId, extToken, extDecimals, enabled);
    }

/* ===================================================================== */
/*                            DEPOSIT FLOW                               */
/* ===================================================================== */

    /**
     * Step-1  (relayer) – record that a deposit happened on chain X.
     *
     * The relayer must call this only once per `(chainId, txHash)` pair.
     * We deliberately *do NOT* mint here – off-chain can apply additional
     * confirmation windows or fraud checks before step-2.
     */
    function deposit(
        uint256 srcChainId,
        string  ethTxHash,
        address token,
        uint256 amount,
        address user
    )
        external
        onlyRelayer
        whenDepositsOpen
        nonReentrant
    {
        require(tokenFactory.isTokenActive(token), "MB: inactive token");
        AssetInfo memory a = assets[token];
        require(a.enabled, "MB: asset off");
        require(a.chainId == srcChainId, "MB: wrong chain");
        require(chains[srcChainId].enabled, "MB: chain off");
        require(amount > 0,"MB: zero");

        // replay protection on composite key
        require(deposits[srcChainId][ethTxHash].bridgeStatus == BridgeStatus.NONE,"MB: dup key");

        deposits[srcChainId][ethTxHash] = DepositInfo(
            token,
            user,
            amount,
            BridgeStatus.INITIATED
        );

        emit DepositInitiated(
            srcChainId, ethTxHash, token, amount, user
        );
    }

    /**
     * Step-2  (relayer) – after off-chain finality, mint wrapped tokens.
     */
    function confirmDeposit(uint256 srcChainId, string calldata ethTxHash)
        external
        onlyRelayer
        whenDepositsOpen
        nonReentrant
    {
        DepositInfo storage d = deposits[srcChainId][ethTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

        Token(d.token).mint(d.user, d.amount);

        d.bridgeStatus = BridgeStatus.COMPLETED;
        emit DepositCompleted(srcChainId, ethTxHash);
    }

/* ===================================================================== */
/*                          WITHDRAWAL FLOW                              */
/* ===================================================================== */

    /**
     * Step-1 (user) – move tokens into bridge escrow and create request.
     * Returns deterministic id  so indexers can
     * enumerate without extra mappings.
     */
    function requestWithdrawal(
        uint256 destChainId,
        address token,
        uint256 amount,
        address destAddress
    )
        external
        whenWithdrawalsOpen
        nonReentrant
        returns (uint256 id)
    {
        require(tokenFactory.isTokenActive(token),"MB: inactive");
        AssetInfo memory a = assets[token];
        require(a.enabled, "MB: asset off");
        require(a.chainId == destChainId, "MB: wrong chain");
        require(chains[destChainId].enabled, "MB: chain off");
        require(amount > 0,"MB: zero");

        uint256 cap = tokenLimits[token].maxPerTx;
        require(cap == 0 || amount<=cap,"MB: per-tx cap");

        /* pull user funds; bridge holds until Safe executes */
        IERC20(token).transferFrom(msg.sender, address(this), amount);

        id = ++withdrawalCounter;

        withdrawals[id] = WithdrawalInfo(
            destChainId,
            token,
            msg.sender,
            destAddress,
            amount,
            block.timestamp,
            BridgeStatus.INITIATED
        );

        emit WithdrawalRequested(
            id, destChainId, token, amount, msg.sender, destAddress
        );
    }

    /**
     * Step-2 (relayer) – Safe tx has been *created* (but not executed).
     * We store the hash so UI can show approval progress.
     */
    function confirmWithdrawal(uint256 id, string safeTxHash)
        external
        onlyRelayer
        whenWithdrawalsOpen
        nonReentrant
    {
        WithdrawalInfo storage w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.INITIATED,"MB: bad state");

        w.bridgeStatus = BridgeStatus.PENDING_SAFE;
        emit WithdrawalPendingSafe(id, safeTxHash);
    }

    /**
     * Step-3 (relayer) – Safe tx executed successfully; burn escrow.
     */
    function finaliseWithdrawal(uint256 id, string safeTxHash)
        external
        onlyRelayer
        whenWithdrawalsOpen
        nonReentrant
    {
        WithdrawalInfo storage w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.PENDING_SAFE,"MB: bad state");

        Token(w.token).burn(address(this), w.amount);

        w.bridgeStatus = BridgeStatus.COMPLETED;
        emit WithdrawalCompleted(id, safeTxHash);
    }

    /**
     * Abort – user (after 48 h) *or* owner may cancel and refund the
     * escrowed tokens.  Covers the scenario where Safe tx is never signed
     * or relayer disappears.
     */
    function abortWithdrawal(uint256 id) external nonReentrant {
        WithdrawalInfo storage w = withdrawals[id];
        require(
            w.bridgeStatus == BridgeStatus.INITIATED || w.bridgeStatus == BridgeStatus.PENDING_SAFE,
            "MB: not abortable"
        );

        if (msg.sender == w.user) {
            /* user path – enforce timeout */
            require(
                block.timestamp >= w.requestedAt + WITHDRAWAL_ABORT_DELAY,
                "MB: wait 48h"
            );
        } else {
            /* owner path – immediate override */
            require(msg.sender == owner(), "MB: only owner");
        }

        w.bridgeStatus = BridgeStatus.ABORTED;
        IERC20(w.token).transfer(w.user, w.amount);
        emit WithdrawalAborted(id);
    }
}
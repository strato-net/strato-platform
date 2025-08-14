/*  ─────────────────────────────────────────────────────────────────────────
    MercataBridge  –  STRATO <-> External EVM value tunnel
    ------------------------------------------------------------------------
    TRUST MODEL
      • Funds on external chain live in a multisig wallet.
      • A single on-chain contract on STRATO books mint / burn of wrapped
        tokens; it does *not* verify Ethereum state – that’s the relayer’s job.
      • The off-chain Relayer is accountable via `onlyRelayer` and on-chain
        replay-protection keys.

    GUARANTEES
      • Canonical supply integrity (mint only once per depositKey).
      • Escrow of tokens on withdrawal until tx executed on Custody wallet
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
contract record MercataBridge is Ownable, ReentrancyGuard {
/* --------------------------------------------------------------------- */
/*                            ─  ENUMS  ─                               */
/* --------------------------------------------------------------------- */
/* One shared enum keeps byte-code small.  The same values are reused
   for deposits and withdrawals.                                         */
    enum BridgeStatus {
        NONE,         // default (mapping unset)
        INITIATED,    // deposit  : relayer observed external tx
                      // withdrawal: user escrowed tokens
        PENDING_APPROVAL, // withdrawal only – Custody tx proposed
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
        uint256 destChainId; // Chain where Custody resides
        address token;       // Token to burn
        address user;        // STRATO sender
        address dest;        // External recipient address
        uint256 amount;      // Escrowed amount
        uint64 requestedAt; // Timestamp – drives abort timeout
        BridgeStatus   bridgeStatus;      // NONE / INITIATED / PENDING_APPROVAL / ...
    }

    struct TokenLimit {
        uint256 maxPerTx;    // Hard ceiling; 0 means “unlimited”
    }

/* --------------------------------------------------------------------- */
/*                         ─  STORAGE  STATE ─                           */
/* --------------------------------------------------------------------- */
    /* Deposit replay-protection: key = (srcChainId, srcTxHashUint) */
    mapping(uint256 => mapping(string => DepositInfo)) public record deposits;

    /* Withdrawal key */
    mapping(uint256 => WithdrawalInfo) public record withdrawals;
    uint256 public withdrawalCounter;       // auto-increment id

    /* Per-token caps defend liquidity                              */
    mapping(address => TokenLimit) public record tokenLimits;

    /* ─── chain & asset registries (on-chain catalogue) ───────────── */
    struct ChainInfo {
        address custody;          // custody on that chain
        address depositRouter; // contract users interact with on L1/L2
        uint256 lastProcessedBlock;
        bool    enabled;       // quick toggle
        string  chainName;
    }

    struct AssetInfo {
        address extToken;      // token address on external chain
        uint256 extDecimals;   // decimals of extToken
        uint256 chainId;       // back-pointer to ChainInfo
        bool    enabled;       // toggle
        string  extName;       // external token name
        string  extSymbol;     // external token symbol
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
        string  srcTxHash,
        address token,
        uint256 amount,
        address indexed user
    );
    event DepositCompleted(uint256 indexed srcChainId, string srcTxHash);   // wrapped tokens minted

    /*  WITHDRAWAL FLOW  */
    event WithdrawalRequested(  // user locked tokens in bridge
        uint256 indexed withdrawalId,
        uint256 indexed destChainId,
        address token,
        uint256 amount,
        address indexed user,
        address dest
    );
    event WithdrawalPending(uint256 indexed withdrawalId, string custodyTxHash);
    event WithdrawalCompleted  (uint256 indexed withdrawalId, string custodyTxHash);
    event WithdrawalAborted    (uint256 indexed withdrawalId);

    /*  ADMIN  */
    event TokenLimitUpdated(address indexed token, uint256 maxPerTx);
    event RelayerUpdated   (address indexed oldRelayer, address indexed newRelayer);
    event TokenFactoryUpdated(address indexed oldFactory, address indexed newFactory);
    event PauseToggled     (bool depositsPaused, bool withdrawalsPaused);
    event ChainUpdated(uint256 indexed chainId, address custody, address router, uint256 lastProcessedBlock, bool enabled, string chainName);
    event AssetUpdated(address indexed stratoToken, uint256 chainId, address extToken, uint256 extDecimals, bool enabled, string extName, string extSymbol);
    event AssetMetadataUpdated(address indexed stratoToken, string extName, string extSymbol);   
    event LastProcessedBlockUpdated(uint256 indexed chainId, uint256 lastProcessedBlock);

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

    /* update token factory */
    function setTokenFactory(address newFactory) external onlyOwner {
        require(newFactory != address(0), "MB: zero");
        address old = address(tokenFactory);
        tokenFactory = TokenFactory(newFactory);
        emit TokenFactoryUpdated(old, newFactory);
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

    function setChain(
        uint256 chainId,
        address custody,
        address router,
        uint256 lastProcessedBlock,
        bool enabled,
        string calldata chainName
    ) external onlyOwner {
        ChainInfo storage c = chains[chainId];
        c.custody = custody;
        c.depositRouter = router;
        c.lastProcessedBlock = lastProcessedBlock;
        c.enabled = enabled;
        c.chainName = chainName;

        emit ChainUpdated(chainId, custody, router, lastProcessedBlock, enabled, chainName);
    }

    function setLastProcessedBlock(uint256 chainId, uint256 lastProcessedBlock) external onlyRelayer
    {
        require(chains[chainId].custody != address(0), "MB: chain missing");
        chains[chainId].lastProcessedBlock = lastProcessedBlock;
        emit LastProcessedBlockUpdated(chainId, lastProcessedBlock);
    }

    function setAsset(
        address stratoToken,
        uint256 chainId,
        address extToken,
        uint256 extDecimals,
        bool enabled,
        string calldata extName,
        string calldata extSymbol
    ) external onlyOwner {
        require(chains[chainId].custody != address(0), "MB: chain missing");

        AssetInfo storage a = assets[stratoToken];
        a.extToken    = extToken;
        a.extDecimals = extDecimals;
        a.chainId     = chainId;
        a.enabled     = enabled;
        a.extName     = extName;
        a.extSymbol   = extSymbol;

        emit AssetUpdated(stratoToken, chainId, extToken, extDecimals, enabled, extName, extSymbol);
    }

    function setAssetMetadata(
        address stratoToken,
        string calldata extName,
        string calldata extSymbol
    ) external onlyOwner {
        require(assets[stratoToken].extToken != address(0), "MB: asset missing");
        assets[stratoToken].extName   = extName;
        assets[stratoToken].extSymbol = extSymbol;
        emit AssetMetadataUpdated(stratoToken, extName, extSymbol);
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
        string  srcTxHash,
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
        require(deposits[srcChainId][srcTxHash].bridgeStatus == BridgeStatus.NONE,"MB: dup key");

        deposits[srcChainId][srcTxHash] = DepositInfo(
            token,
            user,
            amount,
            BridgeStatus.INITIATED
        );

        emit DepositInitiated(
            srcChainId, srcTxHash, token, amount, user
        );
    }
    
    // ─────────────────────────── BATCH: deposit ───────────────────────────
    function depositBatch(
        uint256[] calldata srcChainIds,
        string[]  calldata srcTxHashes,
        address[] calldata tokens,
        uint256[] calldata amounts,
        address[] calldata users
    )
        external
        onlyRelayer
        whenDepositsOpen
        nonReentrant
    {
        uint256 n = srcChainIds.length;
        require(
            n == srcTxHashes.length &&
            n == tokens.length     &&
            n == amounts.length    &&
            n == users.length,
            "MB: len"
        );

        for (uint256 i = 0; i < n; i++) {
            uint256 srcChainId = srcChainIds[i];
            string memory h    = srcTxHashes[i]; // copy to memory for STRATO sanity

            require(tokenFactory.isTokenActive(tokens[i]), "MB: inactive token");
            AssetInfo memory a = assets[tokens[i]];
            require(a.enabled, "MB: asset off");
            require(a.chainId == srcChainId, "MB: wrong chain");
            require(chains[srcChainId].enabled, "MB: chain off");
            require(amounts[i] > 0, "MB: zero");

            // replay protection
            require(deposits[srcChainId][h].bridgeStatus == BridgeStatus.NONE, "MB: dup key");

            deposits[srcChainId][h] = DepositInfo(
                tokens[i],
                users[i],
                amounts[i],
                BridgeStatus.INITIATED
            );

            emit DepositInitiated(srcChainId, h, tokens[i], amounts[i], users[i]);
        }
    }

    /**
     * Step-2  (relayer) – after off-chain finality, mint wrapped tokens.
     */
    function confirmDeposit(uint256 srcChainId, string calldata srcTxHash)
        external
        onlyRelayer
        whenDepositsOpen
        nonReentrant
    {
        DepositInfo storage d = deposits[srcChainId][srcTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

        Token(d.token).mint(d.user, d.amount);

        d.bridgeStatus = BridgeStatus.COMPLETED;
        emit DepositCompleted(srcChainId, srcTxHash);
    }

    // ──────────────────────── BATCH: confirmDeposit ────────────────────────
    function confirmDepositBatch(
        uint256[] calldata srcChainIds,
        string[]  calldata srcTxHashes
    )
        external
        onlyRelayer
        whenDepositsOpen
        nonReentrant
    {
        uint256 n = srcChainIds.length;
        require(n == srcTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            string memory h = srcTxHashes[i];

            DepositInfo storage d = deposits[srcChainIds[i]][h];
            require(d.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

            Token(d.token).mint(d.user, d.amount);
            d.bridgeStatus = BridgeStatus.COMPLETED;

            emit DepositCompleted(srcChainIds[i], h);
        }
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

        /* pull user funds; bridge holds until approval */
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
     * Step-2 (relayer) – Custody tx has been *created* (but not executed).
     * We store the hash so UI can show approval progress.
     */
    function confirmWithdrawal(uint256 id, string custodyTxHash)
        external
        onlyRelayer
        whenWithdrawalsOpen
        nonReentrant
    {
        WithdrawalInfo storage w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.INITIATED,"MB: bad state");

        w.bridgeStatus = BridgeStatus.PENDING_APPROVAL;
        emit WithdrawalPending(id, custodyTxHash);
    }

    // ─────────────────────── BATCH: confirmWithdrawal ──────────────────────
    function confirmWithdrawalBatch(
        uint256[] calldata ids,
        string[]  calldata custodyTxHashes
    )
        external
        onlyRelayer
        whenWithdrawalsOpen
        nonReentrant
    {
        uint256 n = ids.length;
        require(n == custodyTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            string memory h = custodyTxHashes[i];

            WithdrawalInfo storage w = withdrawals[ids[i]];
            require(w.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

            w.bridgeStatus = BridgeStatus.PENDING_APPROVAL;
            emit WithdrawalPending(ids[i], h);
        }
    }

    /**
     * Step-3 (relayer) – Custody tx executed successfully; burn escrow.
     */
    function finaliseWithdrawal(uint256 id, string custodyTxHash)
        external
        onlyRelayer
        whenWithdrawalsOpen
        nonReentrant
    {
        WithdrawalInfo storage w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.PENDING_APPROVAL,"MB: bad state");

        Token(w.token).burn(address(this), w.amount);

        w.bridgeStatus = BridgeStatus.COMPLETED;
        emit WithdrawalCompleted(id, custodyTxHash);
    }

    // ─────────────────────── BATCH: finaliseWithdrawal ─────────────────────
    function finaliseWithdrawalBatch(
        uint256[] calldata ids,
        string[]  calldata custodyTxHashes
    )
        external
        onlyRelayer
        whenWithdrawalsOpen
        nonReentrant
    {
        uint256 n = ids.length;
        require(n == custodyTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            string memory h = custodyTxHashes[i];

            WithdrawalInfo storage w = withdrawals[ids[i]];
            require(w.bridgeStatus == BridgeStatus.PENDING_APPROVAL, "MB: bad state");

            Token(w.token).burn(address(this), w.amount);
            w.bridgeStatus = BridgeStatus.COMPLETED;

            emit WithdrawalCompleted(ids[i], h);
        }
    }

    /**
     * Abort – user (after 48 h) *or* owner may cancel and refund the
     * escrowed tokens.  Covers the scenario where Custody tx is never signed
     * or relayer disappears.
     */
    function abortWithdrawal(uint256 id) external nonReentrant {
        WithdrawalInfo storage w = withdrawals[id];
        require(
            w.bridgeStatus == BridgeStatus.INITIATED || w.bridgeStatus == BridgeStatus.PENDING_APPROVAL,
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

    function abortWithdrawalBatch(uint256[] calldata ids) external nonReentrant {
        uint256 n = ids.length;
        require(n > 0, "MB: empty");

        // Cache once for gas
        bool callerIsOwner = (msg.sender == owner());

        for (uint256 i = 0; i < n; i++) {
            WithdrawalInfo storage w = withdrawals[ids[i]];

            // must be in an abortable state
            require(
                w.bridgeStatus == BridgeStatus.INITIATED || w.bridgeStatus == BridgeStatus.PENDING_APPROVAL,
                "MB: not abortable"
            );

            if (!callerIsOwner) {
                // only the original user can self-abort, and only after timeout
                require(msg.sender == w.user, "MB: only owner/user");

                // keep time math in uint64 to match STRATO's timestamp width
                uint64 deadline = w.requestedAt + WITHDRAWAL_ABORT_DELAY;
                require(block.timestamp >= deadline, "MB: wait 48h");
            }

            // mark aborted and refund escrow
            w.bridgeStatus = BridgeStatus.ABORTED;
            IERC20(w.token).transfer(w.user, w.amount);

            emit WithdrawalAborted(ids[i]);
        }
    }
}
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
import "../../abstract/ERC20/IERC20.sol";
import "../Tokens/TokenFactory.sol";
import "../Tokens/Token.sol";

/* ───────────────────────────────────────────────────────────────────────── */
contract record MercataBridge is Ownable {
/* --------------------------------------------------------------------- */
/*                            ─  ENUMS  ─                               */
/* --------------------------------------------------------------------- */
/* One shared enum keeps byte-code small.  The same values are reused
   for deposits and withdrawals.                                         */
    enum BridgeStatus {
        NONE,         // default (mapping unset)
        INITIATED,    // deposit  : relayer observed external tx
                      // withdrawal: user escrowed tokens
        PENDING_REVIEW, // deposit: verification failed, needs review
                      // withdrawal: custody tx proposed, waiting for review
        COMPLETED,    // flow fully executed
        ABORTED       // owner/user reclaimed escrow
    }

/* --------------------------------------------------------------------- */
/*                          ─  DATA STRUCTS ─                           */
/* --------------------------------------------------------------------- */
    struct DepositInfo {
        address stratoToken;       // STRATO token to mint
        address stratoRecipient;   // STRATO recipient
        uint256 stratoTokenAmount; // STRATO token amount to mint
        address externalSender;    // External chain sender
        BridgeStatus bridgeStatus; // NONE / INITIATED / COMPLETED / ABORTED
        bool mintUSDST;            // true if minting USDST, false if minting original token (e.g. USDC)
        uint256 timestamp;         // timestamp of the deposit
    }

    struct WithdrawalInfo {
        uint256 externalChainId;   // Chain where Custody resides
        address externalRecipient; // External recipient address
        address stratoToken;       // Token to burn
        uint256 stratoTokenAmount; // Escrowed amount of stratoToken
        address stratoSender;      // STRATO sender
        BridgeStatus bridgeStatus; // NONE / INITIATED / PENDING_REVIEW / ...
        bool mintUSDST;           // true = burn USDST, false = unwrap token
        uint256 timestamp;        // timestamp of the withdrawal
        uint256 requestedAt;      // timestamp of the withdrawal request (for abort accuracy)
    }

/* --------------------------------------------------------------------- */
/*                         ─  STORAGE  STATE ─                           */
/* --------------------------------------------------------------------- */
    /* Deposit replay-protection: key = (externalChainId, externalTxHash) */
    mapping(uint256 => mapping(string => DepositInfo)) public record deposits;

    /* Withdrawal key */
    mapping(uint256 => WithdrawalInfo) public record withdrawals;
    uint256 public withdrawalCounter;       // auto-increment id

    /* ─── chain & asset registries (on-chain catalogue) ───────────── */
    struct ChainInfo {
        address custody;            // custody on that chain
        address depositRouter;      // contract users interact with on L1/L2
        uint256 lastProcessedBlock; // last processed block on the chain for polling
        bool    enabled;            // quick toggle
        string  chainName;
    }

    struct AssetInfo {
        address externalToken;    // token address on external chain
        uint256 externalDecimals; // decimals of externalToken
        uint256 externalChainId;  // back-pointer to ChainInfo
        string  externalName;     // external token name
        string  externalSymbol;   // external token symbol
        bool    enabled;          // toggle
        uint256 maxPerTx;         // hard ceiling; 0 means "unlimited"
        bool    mintUSDST;        // true if asset can be minted to USDST
    }

    mapping(uint256 => ChainInfo) public record chains;   
    mapping(address => AssetInfo) public record assets;   

    /* ─────────────────────────────── */

    TokenFactory public tokenFactory;  // single source of "active token" truth
    address      public relayer;       // off-chain orchestrator account

    bool public depositsPaused;        // independent circuit breakers
    bool public withdrawalsPaused;

    /* Users may abort a stuck withdrawal after 48 h                     */
    uint256 public WITHDRAWAL_ABORT_DELAY = 172800;

    /* USDST token address for cross-chain minting/redeeming */
    address public USDST_ADDRESS = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);

/* --------------------------------------------------------------------- */
/*                               EVENTS                                  */
/* --------------------------------------------------------------------- */
    /*  DEPOSIT FLOW  */
    event DepositInitiated(   // relayer observed ETH tx
        uint256 indexed externalChainId,
        string  externalTxHash,
        address stratoToken,
        uint256 stratoTokenAmount,
        address indexed stratoRecipient,
        address externalSender,
        bool mintUSDST
    );
    event DepositCompleted(uint256 indexed srcChainId, string srcTxHash);   // wrapped tokens minted
    event DepositPendingReview(uint256 indexed srcChainId, string srcTxHash);   // verification failed, needs review

    /*  WITHDRAWAL FLOW  */
    event WithdrawalRequested(  // user locked tokens in bridge
        uint256 indexed withdrawalId,
        uint256 indexed destChainId,
        address token,
        uint256 amount,
        address indexed user,
        address dest,
        bool mint
    );
    event WithdrawalPending(uint256 indexed withdrawalId, string custodyTxHash);
    event WithdrawalCompleted  (uint256 indexed withdrawalId, string custodyTxHash);
    event WithdrawalAborted    (uint256 indexed withdrawalId);

    /*  ADMIN  */
    event RelayerUpdated   (address indexed oldRelayer, address indexed newRelayer);
    event TokenFactoryUpdated(address indexed oldFactory, address indexed newFactory);
    event PauseToggled     (bool depositsPaused, bool withdrawalsPaused);
    event ChainUpdated(uint256 indexed externalChainId, address custody, address router, uint256 lastProcessedBlock, bool enabled, string chainName);
    event AssetUpdated(address indexed stratoToken, uint256 externalChainId, address externalToken, uint256 externalDecimals, string externalName, string externalSymbol, bool enabled, uint256 maxPerTx, bool mintUSDST);
    event LastProcessedBlockUpdated(uint256 indexed externalChainId, uint256 lastProcessedBlock);

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
    function setTokenLimits(address stratoToken, uint256 maxPerTx)
        external
        onlyOwner
    {
        require(assets[stratoToken].externalToken != address(0), "MB: asset missing");
        AssetInfo storage a = assets[stratoToken];
        a.maxPerTx = maxPerTx;
        emit AssetUpdated(stratoToken, a.externalChainId, a.externalToken, a.externalDecimals, a.externalName, a.externalSymbol, a.enabled, maxPerTx, a.mintUSDST);
    }

    function setChain(
        uint256 externalChainId,
        address custody,
        address router,
        uint256 lastProcessedBlock,
        bool enabled,
        string calldata chainName
    ) external onlyOwner {
        ChainInfo storage c = chains[externalChainId];
        c.custody = custody;
        c.depositRouter = router;
        c.lastProcessedBlock = lastProcessedBlock;
        c.enabled = enabled;
        c.chainName = chainName;

        emit ChainUpdated(externalChainId, custody, router, lastProcessedBlock, enabled, chainName);
    }

    function setLastProcessedBlock(uint256 externalChainId, uint256 lastProcessedBlock) external onlyRelayer
    {
        require(chains[externalChainId].custody != address(0), "MB: chain missing");
        chains[externalChainId].lastProcessedBlock = lastProcessedBlock;
        emit LastProcessedBlockUpdated(externalChainId, lastProcessedBlock);
    }

    function setAsset(
        address stratoToken,
        uint256 externalChainId,
        address externalToken,
        uint256 externalDecimals,
        bool enabled,
        string calldata externalName,
        string calldata externalSymbol,
        uint256 maxPerTx,
        bool mintUSDST
    ) external onlyOwner {
        require(chains[externalChainId].custody != address(0), "MB: chain missing");

        AssetInfo storage a = assets[stratoToken];
        a.externalToken    = externalToken;
        a.externalDecimals = externalDecimals;
        a.externalChainId  = externalChainId;
        a.externalName     = externalName;
        a.externalSymbol   = externalSymbol;
        a.enabled          = enabled;
        a.maxPerTx         = maxPerTx;
        a.mintUSDST        = mintUSDST;

        emit AssetUpdated(stratoToken, externalChainId, externalToken, externalDecimals, externalName, externalSymbol, enabled, maxPerTx, mintUSDST);
    }

    function setAssetMetadata(
        address stratoToken,
        string calldata externalName,
        string calldata externalSymbol
    ) external onlyOwner {
        require(assets[stratoToken].externalToken != address(0), "MB: asset missing");
        AssetInfo storage a = assets[stratoToken];
        a.externalName   = externalName;
        a.externalSymbol = externalSymbol;
        emit AssetUpdated(stratoToken, a.externalChainId, a.externalToken, a.externalDecimals, externalName, externalSymbol, a.enabled, a.maxPerTx, a.mintUSDST);
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
        uint256 externalChainId,
        address externalSender,
        string  externalTxHash,
        address stratoToken,
        uint256 stratoTokenAmount,
        address stratoRecipient,
        bool mintUSDST
    )
        external
        onlyRelayer
        whenDepositsOpen
    {
        require(tokenFactory.isTokenActive(stratoToken), "MB: inactive token");
        AssetInfo memory a = assets[stratoToken];
        require(a.enabled, "MB: asset off");
        require(a.externalChainId == externalChainId, "MB: wrong chain");
        require(chains[externalChainId].enabled, "MB: chain off");
        require(stratoTokenAmount > 0,"MB: zero");
        require(!mintUSDST || a.mintUSDST, "MB: not mintable");

        // replay protection on composite key
        require(deposits[externalChainId][externalTxHash].bridgeStatus == BridgeStatus.NONE,"MB: dup key");

        deposits[externalChainId][externalTxHash] = DepositInfo(
            stratoToken,
            stratoRecipient,
            stratoTokenAmount,
            externalSender,
            BridgeStatus.INITIATED,
            mintUSDST,
            block.timestamp
        );

        emit DepositInitiated(
            externalChainId, externalTxHash, stratoToken, stratoTokenAmount, stratoRecipient, externalSender, mintUSDST
        );
    }
    
    // ─────────────────────────── BATCH: deposit ───────────────────────────
    function depositBatch(
        uint256[] calldata externalChainIds,
        string[]  calldata externalTxHashes,
        address[] calldata stratoTokens,
        uint256[] calldata stratoTokenAmounts,
        address[] calldata stratoRecipients,
        address[] calldata externalSenders,
        bool[] calldata mintUSDSTs
    )
        external
        onlyRelayer
        whenDepositsOpen
    {
        uint256 n = externalChainIds.length;
        require(
            n == externalTxHashes.length   &&
            n == stratoTokens.length       &&
            n == stratoTokenAmounts.length &&
            n == stratoRecipients.length   &&
            n == externalSenders.length    &&
            n == mintUSDSTs.length,
            "MB: len"
        );

        for (uint256 i = 0; i < n; i++) {
            uint256 externalChainId = externalChainIds[i];
            string memory h = externalTxHashes[i];

            require(tokenFactory.isTokenActive(stratoTokens[i]), "MB: inactive token");
            AssetInfo memory a = assets[stratoTokens[i]];
            require(a.enabled, "MB: asset off");
            require(a.externalChainId == externalChainId, "MB: wrong chain");
            require(chains[externalChainId].enabled, "MB: chain off");
            require(stratoTokenAmounts[i] > 0, "MB: zero");
            require(!mintUSDSTs[i] || a.mintUSDST, "MB: not mintable");

            // replay protection
            require(deposits[externalChainId][h].bridgeStatus == BridgeStatus.NONE, "MB: dup key");

            deposits[externalChainId][h] = DepositInfo(
                stratoTokens[i],
                stratoRecipients[i],
                stratoTokenAmounts[i],
                externalSenders[i],
                BridgeStatus.INITIATED,
                mintUSDSTs[i],
                block.timestamp
            );

            emit DepositInitiated(externalChainId, h, stratoTokens[i], stratoTokenAmounts[i], stratoRecipients[i], externalSenders[i], mintUSDSTs[i]);
        }
    }

    /**
     * Step-2.1 (relayer) – Verification passed, mint wrapped tokens.
     */
    function confirmDeposit(uint256 externalChainId, string calldata externalTxHash)
        external
        onlyRelayer
        whenDepositsOpen
    {
        DepositInfo storage d = deposits[externalChainId][externalTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

        if (d.mintUSDST) {
            Token(USDST_ADDRESS).mint(d.stratoRecipient, d.stratoTokenAmount);
        } else {
            Token(d.stratoToken).mint(d.stratoRecipient, d.stratoTokenAmount);
        }

        d.bridgeStatus = BridgeStatus.COMPLETED;
        emit DepositCompleted(externalChainId, externalTxHash);
    }

    // ──────────────────────── BATCH: confirmDeposit ────────────────────────
    function confirmDepositBatch(
        uint256[] calldata externalChainIds,
        string[]  calldata externalTxHashes
    )
        external
        onlyRelayer
        whenDepositsOpen
    {
        uint256 n = externalChainIds.length;
        require(n == externalTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            string memory h = externalTxHashes[i];

            DepositInfo storage d = deposits[externalChainIds[i]][h];
            require(d.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

            if (d.mintUSDST) {
                Token(USDST_ADDRESS).mint(d.stratoRecipient, d.stratoTokenAmount);
            } else {
                Token(d.stratoToken).mint(d.stratoRecipient, d.stratoTokenAmount);
            }
            
            d.bridgeStatus = BridgeStatus.COMPLETED;

            emit DepositCompleted(externalChainIds[i], h);
        }
    }

    /**
     * Step-2.2 (relayer) – Verification failed, set deposit for manual review
     */
    function reviewDeposit(uint256 externalChainId, string calldata externalTxHash)
        external
        onlyRelayer
        whenDepositsOpen
    {
        DepositInfo storage d = deposits[externalChainId][externalTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

        d.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        emit DepositPendingReview(externalChainId, externalTxHash);
    }

    // ──────────────────────── BATCH: reviewDeposit ────────────────────────
    function reviewDepositBatch(
        uint256[] calldata externalChainIds,
        string[] calldata externalTxHashes
    )
        external
        onlyRelayer
        whenDepositsOpen
    {
        uint256 n = externalChainIds.length;
        require(n == externalTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            string memory h = externalTxHashes[i];

            DepositInfo storage d = deposits[externalChainIds[i]][h];
            require(d.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

            d.bridgeStatus = BridgeStatus.PENDING_REVIEW;
            emit DepositPendingReview(externalChainIds[i], h);
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
        uint256 externalChainId,
        address externalRecipient,
        address stratoToken,
        uint256 stratoTokenAmount,
        bool mintUSDST
    )
        external
        whenWithdrawalsOpen
        returns (uint256 id)
    {
        require(tokenFactory.isTokenActive(stratoToken),"MB: inactive");
        AssetInfo memory a = assets[stratoToken];
        require(a.enabled, "MB: asset off");
        require(a.externalChainId == externalChainId, "MB: wrong chain");
        require(chains[externalChainId].enabled, "MB: chain off");
        require(stratoTokenAmount > 0,"MB: zero");
        require(!mintUSDST || a.mintUSDST, "MB: not mintable");

        uint256 cap = a.maxPerTx;
        require(cap == 0 || stratoTokenAmount<=cap,"MB: per-tx cap");

        /* pull user funds; bridge holds until approval */
        IERC20(mintUSDST ? USDST_ADDRESS : stratoToken).transferFrom(msg.sender, address(this), stratoTokenAmount);

        id = ++withdrawalCounter;

        withdrawals[id] = WithdrawalInfo(
            externalChainId,
            externalRecipient,
            stratoToken,
            stratoTokenAmount,
            msg.sender,
            BridgeStatus.INITIATED,
            mintUSDST,
            block.timestamp,
            block.timestamp
        );

        emit WithdrawalRequested(
            id, externalChainId, stratoToken, stratoTokenAmount, msg.sender, externalRecipient, mintUSDST
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
    {
        WithdrawalInfo storage w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.INITIATED,"MB: bad state");

        w.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        w.timestamp = block.timestamp;
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
    {
        uint256 n = ids.length;
        require(n == custodyTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            string memory h = custodyTxHashes[i];

            WithdrawalInfo storage w = withdrawals[ids[i]];
            require(w.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

            w.bridgeStatus = BridgeStatus.PENDING_REVIEW;
            w.timestamp = block.timestamp;
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
    {
        WithdrawalInfo storage w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.PENDING_REVIEW,"MB: bad state");

        if (w.mintUSDST) {
            Token(USDST_ADDRESS).burn(address(this), w.stratoTokenAmount);
        } else {
            Token(w.stratoToken).burn(address(this), w.stratoTokenAmount);
        }

        w.bridgeStatus = BridgeStatus.COMPLETED;
        w.timestamp = block.timestamp;
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
    {
        uint256 n = ids.length;
        require(n == custodyTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            string memory h = custodyTxHashes[i];

            WithdrawalInfo storage w = withdrawals[ids[i]];
            require(w.bridgeStatus == BridgeStatus.PENDING_REVIEW, "MB: bad state");

            if (w.mintUSDST) {
                Token(USDST_ADDRESS).burn(address(this), w.stratoTokenAmount);
            } else {
                Token(w.stratoToken).burn(address(this), w.stratoTokenAmount);
            }
            
            w.bridgeStatus = BridgeStatus.COMPLETED;
            w.timestamp = block.timestamp;

            emit WithdrawalCompleted(ids[i], h);
        }
    }

    /**
     * Abort – user (after 48 h) *or* owner may cancel and refund the escrowed tokens.
     * Covers the scenario where relayer disappears before confirming.
     * Does not cover the scenario where Custody tx is waiting to be signed.
     */
    function abortWithdrawal(uint256 id) external {
        WithdrawalInfo storage w = withdrawals[id];
        require(
            w.bridgeStatus == BridgeStatus.INITIATED,
            "MB: not abortable"
        );

        if (msg.sender == w.stratoSender) {
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
        w.timestamp = block.timestamp;
        IERC20(w.stratoToken).transfer(w.stratoSender, w.stratoTokenAmount);

        emit WithdrawalAborted(id);
    }

    function abortWithdrawalBatch(uint256[] calldata ids) external {
        uint256 n = ids.length;
        require(n > 0, "MB: empty");

        // Cache once for gas
        bool callerIsOwner = (msg.sender == owner());

        for (uint256 i = 0; i < n; i++) {
            WithdrawalInfo storage w = withdrawals[ids[i]];

            // must be in an abortable state
            require(
                w.bridgeStatus == BridgeStatus.INITIATED || w.bridgeStatus == BridgeStatus.PENDING_REVIEW,
                "MB: not abortable"
            );

            if (!callerIsOwner) {
                // only the original user can self-abort, and only after timeout
                require(msg.sender == w.stratoSender, "MB: only owner/user");

                // keep time math in uint256 to match block.timestamp
                uint256 deadline = w.requestedAt + WITHDRAWAL_ABORT_DELAY;
                require(block.timestamp >= deadline, "MB: wait 48h");
            }

            // mark aborted and refund escrow
            w.bridgeStatus = BridgeStatus.ABORTED;
            w.timestamp = block.timestamp;
            IERC20(w.stratoToken).transfer(w.stratoSender, w.stratoTokenAmount);

            emit WithdrawalAborted(ids[i]);
        }
    }
}
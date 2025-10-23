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
        ABORTED       // user/relayer reclaimed escrow
    }

/* --------------------------------------------------------------------- */
/*                          ─  DATA STRUCTS ─                           */
/* --------------------------------------------------------------------- */
    struct DepositInfo {
        BridgeStatus bridgeStatus; // NONE / INITIATED / COMPLETED / ABORTED
        address externalSender;    // External chain sender
        address externalToken;     // External token deposited
        address stratoRecipient;   // STRATO recipient
        address stratoToken;       // STRATO token to mint
        uint256 stratoTokenAmount; // STRATO token amount to mint
        uint256 timestamp;         // timestamp of the deposit
    }

    struct WithdrawalInfo {
        BridgeStatus bridgeStatus; // NONE / INITIATED / PENDING_REVIEW / ...
        uint256 externalChainId;   // Chain where Custody resides
        address externalRecipient; // External chain recipient
        address externalToken;     // External token to receive
        uint256 requestedAt;      // timestamp of the withdrawal request (for abort accuracy)
        address stratoSender;      // STRATO sender
        address stratoToken;       // STRATO token to burn
        uint256 stratoTokenAmount; // STRATO token amount to burn
        uint256 timestamp;        // timestamp of the withdrawal
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
        uint256 externalChainId;  // back-pointer to ChainInfo
        uint256 externalDecimals; // decimals of externalToken
        string  externalName;     // external token name
        string  externalSymbol;   // external token symbol
        uint256 maxPerTx;         // hard ceiling; 0 means "unlimited"
        address stratoToken;      // STRATO token to mint (ETHst, USDST, etc)
    }
    // key = externalChainId
    mapping(uint256 => ChainInfo) public record chains;
    // key = (externalToken, externalChainId)
    mapping(address => mapping(uint256 => AssetInfo)) public record assets;   

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
        uint256 externalChainId,
        address externalSender,
        string  externalTxHash,
        address stratoRecipient,
        address stratoToken,
        uint256 stratoTokenAmount
    );
    event DepositCompleted(uint256 srcChainId, string srcTxHash);   // wrapped tokens minted
    event DepositPendingReview(uint256 srcChainId, string srcTxHash);   // verification failed, needs review

    /*  WITHDRAWAL FLOW  */
    event WithdrawalRequested(  // user locked tokens in bridge
        uint256 amount,
        address dest,
        uint256 destChainId,
        address token,
        address user,
        uint256 withdrawalId
    );
    event WithdrawalPending(uint256 withdrawalId, string custodyTxHash);
    event WithdrawalCompleted  (uint256 withdrawalId, string custodyTxHash);
    event WithdrawalAborted    (uint256 withdrawalId);

    /*  ADMIN  */
    event RelayerUpdated   (address oldRelayer, address newRelayer);
    event TokenFactoryUpdated(address oldFactory, address newFactory);
    event PauseToggled     (bool depositsPaused, bool withdrawalsPaused);
    event ChainUpdated(string chainName, address custody, bool enabled, uint256 externalChainId, uint256 lastProcessedBlock, address router);
    event AssetUpdated(uint256 externalChainId, uint256 externalDecimals, string externalName, string externalSymbol, address externalToken, uint256 maxPerTx, address stratoToken);
    event LastProcessedBlockUpdated(uint256 externalChainId, uint256 lastProcessedBlock);
    event EmergencyBlockRollback(uint256 externalChainId, uint256 lastProcessedBlock);
    event USDSTAddressUpdated(address oldAddress, address newAddress);

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
    constructor(address _owner) Ownable(_owner) { }

    function initialize(address _tokenFactory, address _relayer) external onlyOwner {
        // @dev important: must be set here for proxied instances; ensure consistency with desired initial values
        WITHDRAWAL_ABORT_DELAY = 172800;
        USDST_ADDRESS = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);

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

    /* update USDST address */
    function setUSDSTAddress(address newUSDSTAddress) external onlyOwner {
        require(newUSDSTAddress != address(0), "MB: zero USDST address");
        address old = USDST_ADDRESS;
        USDST_ADDRESS = newUSDSTAddress;
        emit USDSTAddressUpdated(old, newUSDSTAddress);
    }

    /* hard per-tx cap */
    function setTokenLimits(address externalToken, uint256 externalChainId, uint256 maxPerTx)
        external
        onlyOwner
    {
        require(assets[externalToken][externalChainId].externalToken != address(0), "MB: asset missing");
        AssetInfo a = assets[externalToken][externalChainId];
        a.maxPerTx = maxPerTx;
        emit AssetUpdated(a.externalChainId, a.externalDecimals, a.externalName, a.externalSymbol, externalToken, maxPerTx, a.stratoToken);
    }

    function setChain(
        string chainName,
        address custody,
        bool enabled,
        uint256 externalChainId,
        uint256 lastProcessedBlock,
        address router
    ) external onlyOwner {
        ChainInfo c = chains[externalChainId];
        c.custody = custody;
        c.depositRouter = router;
        c.lastProcessedBlock = lastProcessedBlock;
        c.enabled = enabled;
        c.chainName = chainName;

        emit ChainUpdated(chainName, custody, enabled, externalChainId, lastProcessedBlock, router);
    }

    function setLastProcessedBlock(uint256 externalChainId, uint256 lastProcessedBlock) external onlyRelayer
    {
        require(chains[externalChainId].custody != address(0), "MB: chain missing");
        
        uint256 currentBlock = chains[externalChainId].lastProcessedBlock;
        require(lastProcessedBlock >= currentBlock, "MB: cannot rollback block");
        
        chains[externalChainId].lastProcessedBlock = lastProcessedBlock;
        emit LastProcessedBlockUpdated(externalChainId, lastProcessedBlock);
    }

    function emergencySetLastProcessedBlock(
        uint256 externalChainId, 
        uint256 lastProcessedBlock
    ) external onlyOwner {
        require(chains[externalChainId].custody != address(0), "MB: chain missing");
        
        chains[externalChainId].lastProcessedBlock = lastProcessedBlock;
        emit LastProcessedBlockUpdated(externalChainId, lastProcessedBlock);
        emit EmergencyBlockRollback(externalChainId, lastProcessedBlock);
    }

    function setAsset(
        uint256 externalChainId,
        uint256 externalDecimals,
        string externalName,
        string externalSymbol,
        address externalToken,
        uint256 maxPerTx,
        address stratoToken
    ) external onlyOwner {
        require(chains[externalChainId].custody != address(0), "MB: chain missing");

        AssetInfo a = assets[externalToken][externalChainId];
        a.stratoToken      = stratoToken;
        a.externalToken    = externalToken;
        a.externalDecimals = externalDecimals;
        a.externalChainId  = externalChainId;
        a.externalName     = externalName;
        a.externalSymbol   = externalSymbol;
        a.maxPerTx         = maxPerTx;

        emit AssetUpdated(externalChainId, externalDecimals, externalName, externalSymbol, externalToken, maxPerTx, stratoToken);
    }

    function setAssetMetadata(
        uint256 externalChainId,
        string externalName,
        string externalSymbol,
        address externalToken
    ) external onlyOwner {
        require(assets[externalToken][externalChainId].externalToken != address(0), "MB: asset missing");
        AssetInfo a = assets[externalToken][externalChainId];
        a.externalName   = externalName;
        a.externalSymbol = externalSymbol;
        emit AssetUpdated(a.externalChainId, a.externalDecimals, externalName, externalSymbol, externalToken, a.maxPerTx, a.stratoToken);
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
        address externalToken,
        string  externalTxHash,
        address stratoRecipient,
        uint256 stratoTokenAmount
    )
        public
        onlyRelayer
        whenDepositsOpen
    {
        AssetInfo a = assets[externalToken][externalChainId];
        require(a.externalChainId == externalChainId, "MB: wrong chain");
        require(chains[externalChainId].enabled, "MB: chain off");
        require(stratoTokenAmount > 0,"MB: zero");
        require(stratoRecipient != address(0), "MB: invalid recipient");
        require(tokenFactory.isTokenActive(a.stratoToken), "MB: inactive token");

        // replay protection on composite key
        require(deposits[externalChainId][externalTxHash].bridgeStatus == BridgeStatus.NONE,"MB: dup key");

        deposits[externalChainId][externalTxHash] = DepositInfo(
            BridgeStatus.INITIATED,
            externalSender,
            externalToken,
            stratoRecipient,
            a.stratoToken,
            stratoTokenAmount,
            block.timestamp
        );

        emit DepositInitiated(
            externalChainId, externalSender, externalTxHash, stratoRecipient, a.stratoToken, stratoTokenAmount
        );
    }
    
    // ─────────────────────────── BATCH: deposit ───────────────────────────
    function depositBatch(
        // out-of-order arguments left for compatibility
        uint256[] externalChainIds,
        address[] externalSenders,
        address[] externalTokens,
        string[]  externalTxHashes,
        address[] stratoRecipients,
        uint256[] stratoTokenAmounts
    )
        external
        onlyRelayer
        whenDepositsOpen
    {
        uint256 n = externalChainIds.length;
        require(
            n == externalTxHashes.length   &&
            n == externalTokens.length     &&
            n == stratoTokenAmounts.length &&
            n == stratoRecipients.length   &&
            n == externalSenders.length,
            "MB: len"
        );

        for (uint256 i = 0; i < n; i++) {
            deposit(
                externalChainIds[i],
                externalSenders[i],
                externalTokens[i],
                externalTxHashes[i],
                stratoRecipients[i],
                stratoTokenAmounts[i]
            );
        }
    }

    /**
     * Step-2.1 (relayer) – Verification passed, mint wrapped tokens.
     */
    function confirmDeposit(uint256 externalChainId, string externalTxHash)
        public
        onlyRelayer
        whenDepositsOpen
    {
        DepositInfo d = deposits[externalChainId][externalTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

        Token(d.stratoToken).mint(d.stratoRecipient, d.stratoTokenAmount);

        d.bridgeStatus = BridgeStatus.COMPLETED;
        emit DepositCompleted(externalChainId, externalTxHash);
    }

    // ──────────────────────── BATCH: confirmDeposit ────────────────────────
    function confirmDepositBatch(
        uint256[] externalChainIds,
        string[]  externalTxHashes
    )
        external
        onlyRelayer
        whenDepositsOpen
    {
        uint256 n = externalChainIds.length;
        require(n == externalTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            confirmDeposit(
                externalChainIds[i],
                externalTxHashes[i]
            );
        }
    }

    /**
     * Step-2.2 (relayer) – Verification failed, set deposit for manual review
     */
    function reviewDeposit(uint256 externalChainId, string externalTxHash)
        public
        onlyRelayer
        whenDepositsOpen
    {
        DepositInfo d = deposits[externalChainId][externalTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

        d.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        emit DepositPendingReview(externalChainId, externalTxHash);
    }

    // ──────────────────────── BATCH: reviewDeposit ────────────────────────
    function reviewDepositBatch(
        uint256[] externalChainIds,
        string[] externalTxHashes
    )
        external
        onlyRelayer
        whenDepositsOpen
    {
        uint256 n = externalChainIds.length;
        require(n == externalTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            reviewDeposit(
                externalChainIds[i],
                externalTxHashes[i]
            );
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
        address externalToken,
        uint256 stratoTokenAmount
    )
        external
        whenWithdrawalsOpen
        returns (uint256 id)
    {
        AssetInfo a = assets[externalToken][externalChainId];
        require(a.externalChainId == externalChainId, "MB: wrong chain");
        require(chains[externalChainId].enabled, "MB: chain off");
        require(stratoTokenAmount > 0,"MB: zero");
        require(a.maxPerTx == 0 || stratoTokenAmount <= a.maxPerTx, "MB: per-tx cap");
        require(tokenFactory.isTokenActive(a.stratoToken), "MB: inactive token");

        /* pull user funds; bridge holds until approval */
        IERC20(a.stratoToken).transferFrom(msg.sender, address(this), stratoTokenAmount);

        id = ++withdrawalCounter;

        withdrawals[id] = WithdrawalInfo(
            BridgeStatus.INITIATED,
            externalChainId,
            externalRecipient,
            externalToken,
            block.timestamp,
            msg.sender,
            a.stratoToken,
            stratoTokenAmount,
            block.timestamp
        );

        emit WithdrawalRequested(
            stratoTokenAmount, externalRecipient, externalChainId, a.stratoToken, msg.sender, id
        );
    }

    /**
     * Step-2 (relayer) – Custody tx has been *created* (but not executed).
     * We store the hash so UI can show approval progress.
     */
    function confirmWithdrawal(uint256 id, string custodyTxHash)
        public
        onlyRelayer
        whenWithdrawalsOpen
    {
        WithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.INITIATED,"MB: bad state");

        w.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        w.timestamp = block.timestamp;
        emit WithdrawalPending(id, custodyTxHash);
    }

    // ─────────────────────── BATCH: confirmWithdrawal ──────────────────────
    function confirmWithdrawalBatch(
        uint256[] ids,
        string[]  custodyTxHashes
    )
        external
        onlyRelayer
        whenWithdrawalsOpen
    {
        uint256 n = ids.length;
        require(n == custodyTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            confirmWithdrawal(
                ids[i],
                custodyTxHashes[i]
            );
        }
    }

    /**
     * Step-3 (relayer) – Custody tx executed successfully; burn escrow.
     */
    function finaliseWithdrawal(uint256 id, string custodyTxHash)
        public
        onlyRelayer
        whenWithdrawalsOpen
    {
        WithdrawalInfo w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.PENDING_REVIEW,"MB: bad state");

        Token(w.stratoToken).burn(address(this), w.stratoTokenAmount);

        w.bridgeStatus = BridgeStatus.COMPLETED;
        w.timestamp = block.timestamp;
        emit WithdrawalCompleted(id, custodyTxHash);
    }

    // ─────────────────────── BATCH: finaliseWithdrawal ─────────────────────
    function finaliseWithdrawalBatch(
        uint256[] ids,
        string[]  custodyTxHashes
    )
        external
        onlyRelayer
        whenWithdrawalsOpen
    {
        uint256 n = ids.length;
        require(n == custodyTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            finaliseWithdrawal(
                ids[i],
                custodyTxHashes[i]
            );
        }
    }

    /**
     * Abort – user (after 48 h) *or* relayer may cancel and refund the escrowed tokens.
     * Covers the scenario where relayer disappears before confirming.
     * Does not cover the scenario where Custody tx is waiting to be signed.
     */
    function abortWithdrawal(uint256 id) public {
        WithdrawalInfo w = withdrawals[id];

        if (msg.sender == relayer) {
            /* withdrawal must not be completed */
            if (w.bridgeStatus == BridgeStatus.ABORTED) {return;} //idempotent 
            require(
                w.bridgeStatus == BridgeStatus.INITIATED ||
                w.bridgeStatus == BridgeStatus.PENDING_REVIEW,
                "MB: not abortable"
            );
        }
        else {
            require(msg.sender == w.stratoSender, "MB: not sender");
            /* user path - may only abort if withdrawal not confirmed */
            require(
                w.bridgeStatus == BridgeStatus.INITIATED,
                "MB: not abortable"
            );
            /* user path – enforce timeout */
            require(
                block.timestamp >= w.requestedAt + WITHDRAWAL_ABORT_DELAY,
                "MB: wait 48h"
            );
        }

        w.bridgeStatus = BridgeStatus.ABORTED;
        w.timestamp = block.timestamp;

        IERC20(w.stratoToken).transfer(w.stratoSender, w.stratoTokenAmount);

        emit WithdrawalAborted(id);
    }

    function abortWithdrawalBatch(uint256[] ids) external {
        uint256 n = ids.length;
        require(n > 0, "MB: empty");

        for (uint256 i = 0; i < n; i++) {
            abortWithdrawal(ids[i]);
        }
    }
}
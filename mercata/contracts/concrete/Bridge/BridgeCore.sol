/*  ─────────────────────────────────────────────────────────────────────────
    BridgeCore  –  STRATO <-> External EVM value tunnel (Modular)
    ------------------------------------------------------------------------
    TRUST MODEL
      • Funds on external chain live in a multisig wallet.
      • A single on-chain contract on STRATO books mint / burn of wrapped
        tokens; it does *not* verify Ethereum state – that's the relayer's job.
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
import "../../abstract/Bridge/BridgeEscrow.sol";
import "../../abstract/Bridge/BridgeAdmin.sol";
import "../Tokens/TokenFactory.sol";
import "../Tokens/Token.sol";
import "../../libraries/Bridge/BridgeTypes.sol";

contract record BridgeCore is BridgeEscrow, BridgeAdmin {
    /* Deposit replay-protection: key = (externalChainId, externalTxHash) */
    mapping(uint256 => mapping(string => DepositInfo)) public record deposits;

    /* Withdrawal key */
    mapping(uint256 => WithdrawalInfo) public record withdrawals;
    uint256 public withdrawalCounter;       // auto-increment id

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
    event DepositAborted(uint256 srcChainId, string srcTxHash);

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

/* --------------------------------------------------------------------- */
/*                             CONSTRUCTOR                               */
/* --------------------------------------------------------------------- */
    constructor(address _owner) BridgeAdmin(_owner) { }

    function initialize(address _tokenFactory, address _relayer) external onlyOwner {
        // @dev important: must be set here for proxied instances; ensure consistency with desired initial values
        WITHDRAWAL_ABORT_DELAY = 172800;
        USDST_ADDRESS = address(0x937efa7e3a77e20bbdbd7c0d32b6514f368c1010);

        require(_tokenFactory != address(0) && _relayer != address(0), "MB: zero");
        tokenFactory = _tokenFactory;
        relayer      = _relayer;
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
        string memory externalTxHash,
        address stratoRecipient,
        uint256 stratoTokenAmount
    )
        public
        onlyRelayer
        whenDepositsOpen
    {
        // Normalize the transaction hash to prevent case-variation replay attacks
        string memory normalizedTxHash = string(uint(externalTxHash, 16), 16);
        
AssetInfo storage a = assets[externalToken][externalChainId];
        require(a.externalChainId == externalChainId, "MB: wrong chain");
        require(chains[externalChainId].enabled, "MB: chain off");
        require(stratoTokenAmount > 0, "MB: zero");
        require(stratoRecipient != address(0), "MB: invalid recipient");
        require(TokenFactory(tokenFactory).isTokenActive(a.stratoToken), "MB: inactive token");

        // replay protection on composite key
        require(deposits[externalChainId][normalizedTxHash].bridgeStatus == BridgeStatus.NONE, "MB: dup key");

        deposits[externalChainId][normalizedTxHash] = DepositInfo(
BridgeStatus.INITIATED,
            externalSender,
            externalToken,
            stratoRecipient,
            a.stratoToken,
            stratoTokenAmount,
            block.timestamp
        );

        emit DepositInitiated(
            externalChainId, externalSender, normalizedTxHash, stratoRecipient, a.stratoToken, stratoTokenAmount
        );
    }
    
    // ─────────────────────────── BATCH: deposit ───────────────────────────
    function depositBatch(
        // out-of-order arguments left for compatibility
        uint256[] memory externalChainIds,
        address[] memory externalSenders,
        address[] memory externalTokens,
        string[] memory externalTxHashes,
        address[] memory stratoRecipients,
        uint256[] memory stratoTokenAmounts
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
    function confirmDeposit(uint256 externalChainId, string memory externalTxHash)
        public
        onlyRelayer
        whenDepositsOpen
    {
        // Normalize the transaction hash to prevent case-variation replay attacks
        string memory normalizedTxHash = string(uint(externalTxHash, 16), 16);
        
DepositInfo storage d = deposits[externalChainId][normalizedTxHash];
        require(
            d.bridgeStatus == BridgeStatus.INITIATED || 
            d.bridgeStatus == BridgeStatus.PENDING_REVIEW, 
            "MB: bad state"
        );

        uint256 actualMinted = _mintFunds(d.stratoToken, d.stratoRecipient, d.stratoTokenAmount);

        d.bridgeStatus = BridgeStatus.COMPLETED;
        emit DepositCompleted(externalChainId, normalizedTxHash);
    }

    // ──────────────────────── BATCH: confirmDeposit ────────────────────────
    function confirmDepositBatch(
        uint256[] memory externalChainIds,
        string[] memory externalTxHashes
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
    function reviewDeposit(uint256 externalChainId, string memory externalTxHash)
        public
        onlyRelayer
        whenDepositsOpen
    {
        // Normalize the transaction hash to prevent case-variation replay attacks
        string memory normalizedTxHash = string(uint(externalTxHash, 16), 16);
        
DepositInfo storage d = deposits[externalChainId][normalizedTxHash];
        require(d.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

        d.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        emit DepositPendingReview(externalChainId, normalizedTxHash);
    }

    // ──────────────────────── BATCH: reviewDeposit ────────────────────────
    function reviewDepositBatch(
        uint256[] memory externalChainIds,
        string[] memory externalTxHashes
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

    /**
     * Step-2.3 (owner) – Cancel a deposit that was marked for review
     */
    function abortDeposit(uint256 externalChainId, string memory externalTxHash)
        public
        onlyOwner
        whenDepositsOpen
    {
        string memory normalizedTxHash = string(uint(externalTxHash, 16), 16);
        
DepositInfo storage d = deposits[externalChainId][normalizedTxHash];
        require(d.bridgeStatus == BridgeStatus.PENDING_REVIEW, "MB: bad state");

        d.bridgeStatus = BridgeStatus.ABORTED;
        emit DepositAborted(externalChainId, normalizedTxHash);
    }

    // ──────────────────────── BATCH: abortDeposit ────────────────────────
    function abortDepositBatch(
        uint256[] memory externalChainIds,
        string[] memory externalTxHashes
    )
        external
        onlyOwner
        whenDepositsOpen
    {
        uint256 n = externalChainIds.length;
        require(n == externalTxHashes.length, "MB: len");

        for (uint256 i = 0; i < n; i++) {
            abortDeposit(
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
AssetInfo storage a = assets[externalToken][externalChainId];
        require(a.externalChainId == externalChainId, "MB: wrong chain");
        require(chains[externalChainId].enabled, "MB: chain off");
        require(stratoTokenAmount > 0, "MB: zero");
        require(externalRecipient != address(0), "MB: zero recipient");
        require(a.maxPerWithdrawal == 0 || stratoTokenAmount <= a.maxPerWithdrawal, "MB: per-withdrawal cap");
        require(TokenFactory(tokenFactory).isTokenActive(a.stratoToken), "MB: inactive token");

        /* pull user funds; bridge holds until approval */
        uint256 actualAmount = _escrowFunds(a.stratoToken, msg.sender, stratoTokenAmount);

        id = ++withdrawalCounter;

        withdrawals[id] = WithdrawalInfo(
            BridgeStatus.INITIATED,
            "",
            externalChainId,
            externalRecipient,
            externalToken,
            block.timestamp,
            msg.sender,
            a.stratoToken,
            actualAmount,
            block.timestamp
        );

        emit WithdrawalRequested(
            actualAmount, externalRecipient, externalChainId, a.stratoToken, msg.sender, id
        );
    }

    /**
     * Step-2 (relayer) – Custody tx has been *created* (but not executed).
     * We store the hash so UI can show approval progress.
     */
    function confirmWithdrawal(uint256 id, string memory custodyTxHash)
        public
        onlyRelayer
        whenWithdrawalsOpen
    {
WithdrawalInfo storage w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.INITIATED, "MB: bad state");

        w.bridgeStatus = BridgeStatus.PENDING_REVIEW;
        w.timestamp = block.timestamp;
        w.custodyTxHash = custodyTxHash;
        emit WithdrawalPending(id, custodyTxHash);
    }

    // ─────────────────────── BATCH: confirmWithdrawal ──────────────────────
    function confirmWithdrawalBatch(
        uint256[] memory ids,
        string[] memory custodyTxHashes
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
    function finaliseWithdrawal(uint256 id, string memory custodyTxHash)
        public
        onlyRelayer
        whenWithdrawalsOpen
    {
WithdrawalInfo storage w = withdrawals[id];
        require(w.bridgeStatus == BridgeStatus.PENDING_REVIEW, "MB: bad state");

        _burnFunds(w.stratoToken, w.stratoTokenAmount);

        w.bridgeStatus = BridgeStatus.COMPLETED;
        w.timestamp = block.timestamp;
        emit WithdrawalCompleted(id, custodyTxHash);
    }

    // ─────────────────────── BATCH: finaliseWithdrawal ─────────────────────
    function finaliseWithdrawalBatch(
        uint256[] memory ids,
        string[] memory custodyTxHashes
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
WithdrawalInfo storage w = withdrawals[id];

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

        _refundFunds(w.stratoToken, w.stratoSender, w.stratoTokenAmount);

        emit WithdrawalAborted(id);
    }

    function abortWithdrawalBatch(uint256[] memory ids) external {
        uint256 n = ids.length;
        require(n > 0, "MB: empty");

        for (uint256 i = 0; i < n; i++) {
            abortWithdrawal(ids[i]);
        }
    }
}
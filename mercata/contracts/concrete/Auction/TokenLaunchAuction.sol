import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/extensions/IERC20Metadata.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "./LpTokenLockVault.sol";

interface IStratoToken is IERC20Metadata {
    function burn(address from, uint256 amount) external;
}

interface ITransferLock {
    function unpause() external;
}

interface ILpSeeder {
    function seedAndLock(uint usdAmount, uint stratoAmount, uint price, address lpTokenRecipient) external returns (address lpToken, uint lpTokensMinted);
}

enum BidState { NULL, ACTIVE, CANCELED, FINALIZED }
enum RefundReason { BID_CANCELED, FINALIZED, AUCTION_CANCELED }

struct Bid {
    address bidder;
    uint budgetUSDST;
    uint maxPriceUSDST;
    uint createdAt;
    uint canceledAt;
    BidState state;
    uint tier;
    uint tokensUncapped;
    uint tokensCapped;
    uint spentUSDST;
    uint refundUSDST;
    uint bonusTokens;
    bool distributed;
    bool distributionVaulted;
    bool canceledRefundWithdrawn;
    bool finalizedRefundWithdrawn;
    uint distributionAttempts;
    uint vaultedImmediate;
    uint vaultedBonusTokens;
    uint tokensDistributed;
}

// Uniform clearing price auction with tiered windows, refunds, and TGE flow.
//
// Bidders escrow USDST with a max price; clearing price P* is the highest
// tick price where aggregate demand >= sale supply.
// On success, tokens are distributed immediately after finalization (before TGE).
// Tokens are non-transferable until TGE unpauses the transfer lock.
// TGE seeds LP, releases treasury/reserve funds, and unpauses transfers.
//
// DEPLOYMENT PREREQUISITE: This contract must be whitelisted in the
// AdminRegistry for the STRATO token's `transfer` and `burn` functions.
//   - `transfer`: gated by Token's `whenNotPausedOrOwner` modifier.
//     While paused, non-owner callers are checked via
//     AdminRegistry.whitelist(token, msg.sig, msg.sender).
//   - `burn`: gated by Token's `onlyOwner` modifier, which falls
//     through to AdminRegistry.castVoteOnIssue() for non-owners.
// Without whitelisting, distribution, burn, and unwind operations
// will revert while the token is paused (pre-TGE).
contract record TokenLaunchAuction is Ownable {

    event AuctionInitialized(address usdToken, address stratoToken, uint saleSupply);
    event AuctionStarted(uint startTime, uint endTime, uint closeBufferStart);
    event BidsPaused();
    event BidsUnpaused();
    event BidPlaced(uint bidId, address bidder, uint budgetUSDST, uint maxPriceUSDST, uint tier);
    event BidCanceled(uint bidId, address bidder, uint budgetUSDST, uint canceledAt);
    event BidFinalized(uint bidId, address bidder, uint tokensCapped, uint spentUSDST, uint refundUSDST);
    event AuctionCanceled(uint cancelTime);
    event Finalized(uint clearingPrice, uint raisedUSDST, bool success);
    event RefundWithdrawn(uint bidId, address bidder, uint amount, RefundReason reason);
    event DistributionProcessed(uint bidId, address bidder, uint tokens);
    event DistributionVaulted(uint bidId, address bidder, uint tokens);
    event VaultedImmediateWithdrawn(uint bidId, address bidder, uint amount);
    event AllowlistConfigured(bool enabled, uint durationSeconds);
    event AllowlistUpdated(address indexed account, bool allowed);
    event TgeScheduled(uint tgeTime);
    event TgeExecuted(uint tgeTime, uint lpUSDST, uint lpSTRATO, uint treasuryUSDST, uint reserveUSDST);
    event PreTgeTreasuryWithdrawn(uint amount);
    event UnsoldBurned(uint amount);
    event BonusBurned(uint amount);
    event Unwound(uint availableUSDST, uint raisedUSDST);
    event DistributionFailed(uint bidId, address bidder);
    event UnwindBurnFailed(uint bidId, address bidder, uint amount);
    event UnwindBurnRetried(uint bidId, address bidder, uint amount);
    event LpReserveReclaimed(uint amount);
    event AuctionConfigUpdated(address caller);
    event FinalizeBatchProgress(uint stageBefore, uint cursorBefore, uint stageAfter, uint cursorAfter, uint steps);

    IERC20Metadata public usdToken;
    IStratoToken public stratoToken;

    address public treasuryWallet;
    address public reserveWallet;
    address public lpSeeder;
    address public lpTokenLockVault;
    address public transferLockController;

    uint public tokenUnit;

    uint public saleSupply;
    uint public claimTokenReserve;
    uint public lpTokenReserve;
    uint public claimReserveRemaining;

    uint public minRaiseUSDST;
    uint public maxRaiseUSDST;
    uint public priceTickUSDST;
    uint public withdrawDelay;
    uint public maxDistributionAttempts;
    uint public bonusTokenReserve;
    uint public bonusTokenReserveRemaining;
    uint public totalVaultedBaseTokens; // Base tokens only (excludes bonus); used by _requiredClaimReserve

    uint public lpBps;
    uint public treasuryBps;
    uint public reserveBps;

    uint public auctionDurationSeconds;
    uint public closeBufferSeconds;
    uint public tier1WindowSeconds;
    uint public tier2WindowSeconds;
    bool public allowlistEnabled;
    uint public allowlistDurationSeconds;

    uint public maxTgeDelay;
    uint public preTgeWithdrawBps;

    bool public initialized;
    bool public auctionStarted;
    bool public auctionCanceled;
    bool public bidsPaused;

    uint public startTime;
    uint public endTime;
    uint public closeBufferStart;
    uint public cancelTime;

    bool public finalized;
    bool public success;
    bool public demandClearsSupply;
    bool public priceFinalized;
    uint public finalizeTime;
    uint public clearingPrice;
    uint public raisedUncappedUSDST;
    uint public raisedUSDST;
    uint public unsoldTokens;
    uint public totalAllocated;

    uint public lpUSDST;
    uint public treasuryUSDST;
    uint public reserveUSDST;
    uint public preTgeWithdrawn;

    uint public pendingDistributions;
    uint public totalRefundsRemaining;
    uint public totalCanceledRefundsRemaining;

    uint public tgeTime;
    bool public tgeExecuted;

    bool public unwound;
    uint public unwindAvailableUSDST;
    uint public unwindRaisedUSDST;
    uint public nextDistributionIndex;
    uint public allocationStage;
    uint public allocationCursor;
    uint public allocationTotalTokensAbove;
    uint public allocationTotalDemandAt;
    uint public allocationRemainingSupply;
    bool public allocationApplyCap;
    uint public allocationRaisedTmp;
    uint public allocationTotalAllocatedTmp;
    uint public bonusStageTotalDemand;

    Bid[] public record bids;
    mapping(address => uint[]) public record userBidIds;
    mapping(address => bool) public record allowlisted;
    mapping(uint => uint) public record activeBudgetByPrice;
    mapping(uint => bool) public record hasActivePriceLevel;
    uint[] public record activePriceLevels;
    uint public activeBidCount;
    uint public unwindPhase;   // 0=idle, 1=batched burn/zero in progress
    uint public unwindCursor;

    constructor(address initialOwner) Ownable(initialOwner) { }

    // One-time setup of tokens, wallets, fees, and timing windows.
    function initialize(
        address usdToken_,
        address stratoToken_,
        address treasuryWallet_,
        address reserveWallet_,
        address lpSeeder_,
        address lpTokenLockVault_,
        address transferLockController_,
        uint saleSupply_,
        uint claimTokenReserve_,
        uint lpTokenReserve_,
        uint minRaiseUSDST_,
        uint maxRaiseUSDST_,
        uint priceTickUSDST_,
        uint withdrawDelay_,
        uint maxDistributionAttempts_,
        uint bonusTokenReserve_,
        uint auctionDurationSeconds_,
        uint closeBufferSeconds_,
        uint tier1WindowSeconds_,
        uint tier2WindowSeconds_,
        bool allowlistEnabled_,
        uint allowlistDurationSeconds_,
        uint lpBps_,
        uint treasuryBps_,
        uint reserveBps_,
        uint preTgeWithdrawBps_,
        uint maxTgeDelay_
    ) external onlyOwner {
        require(!initialized, "Already initialized");
        require(usdToken_ != address(0), "Invalid USDST");
        require(stratoToken_ != address(0), "Invalid STRATO");
        require(treasuryWallet_ != address(0), "Invalid treasury");
        require(reserveWallet_ != address(0), "Invalid reserve");
        require(priceTickUSDST_ > 0, "Invalid price tick");
        require(maxDistributionAttempts_ > 0, "Invalid distribution attempts");
        require(lpBps_ + treasuryBps_ + reserveBps_ == 10000, "Invalid bps");
        require(preTgeWithdrawBps_ <= 10000, "Invalid preTGE bps");
        require(claimTokenReserve_ >= saleSupply_, "Claim reserve < sale supply");
        require(auctionDurationSeconds_ > closeBufferSeconds_, "Close buffer >= duration");
        require(tier2WindowSeconds_ > 0, "Tier2 duration required");
        require(
            tier1WindowSeconds_ + tier2WindowSeconds_ <= auctionDurationSeconds_ - closeBufferSeconds_,
            "Tier windows beyond bidding"
        );

        usdToken = IERC20Metadata(usdToken_);
        stratoToken = IStratoToken(stratoToken_);
        treasuryWallet = treasuryWallet_;
        reserveWallet = reserveWallet_;
        lpSeeder = lpSeeder_;
        lpTokenLockVault = lpTokenLockVault_;
        transferLockController = transferLockController_;

        tokenUnit = 10 ** uint(stratoToken.decimals());

        saleSupply = saleSupply_;
        claimTokenReserve = claimTokenReserve_;
        lpTokenReserve = lpTokenReserve_;
        minRaiseUSDST = minRaiseUSDST_;
        maxRaiseUSDST = maxRaiseUSDST_;
        priceTickUSDST = priceTickUSDST_;
        withdrawDelay = withdrawDelay_;
        maxDistributionAttempts = maxDistributionAttempts_;
        bonusTokenReserve = bonusTokenReserve_;
        bonusTokenReserveRemaining = bonusTokenReserve_;

        lpBps = lpBps_;
        treasuryBps = treasuryBps_;
        reserveBps = reserveBps_;

        auctionDurationSeconds = auctionDurationSeconds_;
        closeBufferSeconds = closeBufferSeconds_;
        tier1WindowSeconds = tier1WindowSeconds_;
        tier2WindowSeconds = tier2WindowSeconds_;
        allowlistEnabled = allowlistEnabled_;
        allowlistDurationSeconds = allowlistDurationSeconds_;
        if (allowlistEnabled) {
            require(allowlistDurationSeconds > 0, "Allowlist duration required");
            require(allowlistDurationSeconds <= tier1WindowSeconds, "Allowlist > tier1");
        }
        require(tier1WindowSeconds > 0, "Tier1 duration required");

        preTgeWithdrawBps = preTgeWithdrawBps_;
        maxTgeDelay = maxTgeDelay_;

        initialized = true;
        emit AuctionInitialized(usdToken_, stratoToken_, saleSupply_);
        emit AllowlistConfigured(allowlistEnabled, allowlistDurationSeconds);
    }

    // Pre-start configuration update for init parameters.
    function updateConfig(
        address usdToken_,
        address stratoToken_,
        address treasuryWallet_,
        address reserveWallet_,
        address lpSeeder_,
        address lpTokenLockVault_,
        address transferLockController_,
        uint saleSupply_,
        uint claimTokenReserve_,
        uint lpTokenReserve_,
        uint minRaiseUSDST_,
        uint maxRaiseUSDST_,
        uint priceTickUSDST_,
        uint withdrawDelay_,
        uint maxDistributionAttempts_,
        uint bonusTokenReserve_,
        uint auctionDurationSeconds_,
        uint closeBufferSeconds_,
        uint tier1WindowSeconds_,
        uint tier2WindowSeconds_,
        bool allowlistEnabled_,
        uint allowlistDurationSeconds_,
        uint lpBps_,
        uint treasuryBps_,
        uint reserveBps_,
        uint preTgeWithdrawBps_,
        uint maxTgeDelay_
    ) external onlyOwner {
        require(initialized, "Not initialized");
        require(!auctionStarted, "Auction started");
        require(!auctionCanceled, "Auction canceled");
        require(!finalized, "Finalized");
        require(usdToken_ != address(0), "Invalid USDST");
        require(stratoToken_ != address(0), "Invalid STRATO");
        require(treasuryWallet_ != address(0), "Invalid treasury");
        require(reserveWallet_ != address(0), "Invalid reserve");
        require(priceTickUSDST_ > 0, "Invalid price tick");
        require(maxDistributionAttempts_ > 0, "Invalid distribution attempts");
        require(lpBps_ + treasuryBps_ + reserveBps_ == 10000, "Invalid bps");
        require(preTgeWithdrawBps_ <= 10000, "Invalid preTGE bps");
        require(claimTokenReserve_ >= saleSupply_, "Claim reserve < sale supply");
        require(auctionDurationSeconds_ > closeBufferSeconds_, "Close buffer >= duration");
        require(tier2WindowSeconds_ > 0, "Tier2 duration required");
        require(
            tier1WindowSeconds_ + tier2WindowSeconds_ <= auctionDurationSeconds_ - closeBufferSeconds_,
            "Tier windows beyond bidding"
        );

        usdToken = IERC20Metadata(usdToken_);
        stratoToken = IStratoToken(stratoToken_);
        treasuryWallet = treasuryWallet_;
        reserveWallet = reserveWallet_;
        lpSeeder = lpSeeder_;
        lpTokenLockVault = lpTokenLockVault_;
        transferLockController = transferLockController_;

        tokenUnit = 10 ** uint(stratoToken.decimals());

        saleSupply = saleSupply_;
        claimTokenReserve = claimTokenReserve_;
        lpTokenReserve = lpTokenReserve_;
        minRaiseUSDST = minRaiseUSDST_;
        maxRaiseUSDST = maxRaiseUSDST_;
        priceTickUSDST = priceTickUSDST_;
        withdrawDelay = withdrawDelay_;
        maxDistributionAttempts = maxDistributionAttempts_;
        bonusTokenReserve = bonusTokenReserve_;
        bonusTokenReserveRemaining = bonusTokenReserve_;

        lpBps = lpBps_;
        treasuryBps = treasuryBps_;
        reserveBps = reserveBps_;

        auctionDurationSeconds = auctionDurationSeconds_;
        closeBufferSeconds = closeBufferSeconds_;
        tier1WindowSeconds = tier1WindowSeconds_;
        tier2WindowSeconds = tier2WindowSeconds_;

        allowlistEnabled = allowlistEnabled_;
        allowlistDurationSeconds = allowlistDurationSeconds_;
        if (allowlistEnabled) {
            require(allowlistDurationSeconds > 0, "Allowlist duration required");
            require(allowlistDurationSeconds <= tier1WindowSeconds, "Allowlist > tier1");
        }
        require(tier1WindowSeconds > 0, "Tier1 duration required");

        preTgeWithdrawBps = preTgeWithdrawBps_;
        maxTgeDelay = maxTgeDelay_;

        emit AuctionConfigUpdated(msg.sender);
        emit AllowlistConfigured(allowlistEnabled, allowlistDurationSeconds);
    }

    // Starts the auction and sets start/end timestamps.
    // Requires STRATO escrow to be in place.
    function startAuction() external onlyOwner {
        require(initialized, "Not initialized");
        require(!auctionStarted, "Already started");
        require(
            stratoToken.balanceOf(address(this)) >= claimTokenReserve + lpTokenReserve + bonusTokenReserve,
            "Insufficient escrow"
        );

        auctionStarted = true;
        claimReserveRemaining = claimTokenReserve;
        activeBidCount = 0;
        startTime = uint(block.timestamp);
        endTime = startTime + auctionDurationSeconds;
        closeBufferStart = endTime - closeBufferSeconds;

        emit AuctionStarted(startTime, endTime, closeBufferStart);
    }

    // Temporarily pause bidding.
    function pauseBids() external onlyOwner {
        require(auctionStarted, "Not started");
        require(!auctionCanceled, "Auction canceled");
        require(!finalized, "Finalized");
        require(block.timestamp < closeBufferStart, "Close buffer");
        bidsPaused = true;
        emit BidsPaused();
    }

    // Resume bidding.
    function unpauseBids() external onlyOwner {
        require(auctionStarted, "Not started");
        require(!auctionCanceled, "Auction canceled");
        require(!finalized, "Finalized");
        require(block.timestamp < closeBufferStart, "Close buffer");
        bidsPaused = false;
        emit BidsUnpaused();
    }

    // Enable/disable allowlist gating and set duration.
    function configureAllowlist(bool enabled, uint durationSeconds) external onlyOwner {
        require(!auctionStarted, "Auction started");
        allowlistEnabled = enabled;
        allowlistDurationSeconds = durationSeconds;
        if (allowlistEnabled) {
            require(allowlistDurationSeconds > 0, "Allowlist duration required");
            require(allowlistDurationSeconds <= tier1WindowSeconds, "Allowlist > tier1");
        }
        emit AllowlistConfigured(allowlistEnabled, allowlistDurationSeconds);
    }

    // Batch update allowlist entries (pre-start).
    function updateAllowlist(address[] accounts, bool allowed) external onlyOwner {
        require(!auctionStarted, "Auction started");
        uint i;
        for (i = 0; i < accounts.length; i++) {
            allowlisted[accounts[i]] = allowed;
            emit AllowlistUpdated(accounts[i], allowed);
        }
    }

    // Place a bid with budget and max price; USDST is escrowed.
    function placeBid(uint budgetUSDST, uint maxPriceUSDST) external {
        require(auctionStarted, "Not started");
        require(!auctionCanceled, "Auction canceled");
        require(!finalized, "Finalized");
        require(!bidsPaused, "Bids paused");
        require(block.timestamp >= startTime, "Not started yet");
        require(block.timestamp < closeBufferStart, "Close buffer");
        require(budgetUSDST > 0, "Invalid budget");
        require(maxPriceUSDST > 0, "Invalid price");
        require(maxPriceUSDST % priceTickUSDST == 0, "Invalid price tick");
        if (allowlistEnabled && block.timestamp < startTime + allowlistDurationSeconds) {
            require(allowlisted[msg.sender], "Allowlist only");
        }

        require(usdToken.transferFrom(msg.sender, address(this), budgetUSDST), "USDST transfer failed");

        uint tier = _tierForTimestamp(uint(block.timestamp));
        require(tier > 0, "Outside bidding windows");
        Bid memory bid;
        bid.bidder = msg.sender;
        bid.budgetUSDST = budgetUSDST;
        bid.maxPriceUSDST = maxPriceUSDST;
        bid.createdAt = uint(block.timestamp);
        bid.canceledAt = 0;
        bid.state = BidState.ACTIVE;
        bid.tier = tier;
        bid.tokensUncapped = 0;
        bid.tokensCapped = 0;
        bid.spentUSDST = 0;
        bid.refundUSDST = 0;
        bid.bonusTokens = 0;
        bid.distributed = false;
        bid.distributionVaulted = false;
        bid.canceledRefundWithdrawn = false;
        bid.finalizedRefundWithdrawn = false;
        bid.distributionAttempts = 0;
        bid.vaultedImmediate = 0;
        bid.vaultedBonusTokens = 0;
        bid.tokensDistributed = 0;

        bids.push(bid);
        uint bidId = bids.length - 1;
        userBidIds[msg.sender].push(bidId);
        activeBidCount = activeBidCount + 1;
        _addActiveBudget(maxPriceUSDST, budgetUSDST);

        emit BidPlaced(bidId, msg.sender, budgetUSDST, maxPriceUSDST, tier);
    }

    // Cancel an active bid before the close buffer window.
    function cancelBid(uint bidId) external {
        require(auctionStarted, "Not started");
        require(!auctionCanceled, "Auction canceled");
        require(!finalized, "Finalized");
        require(block.timestamp < closeBufferStart, "Close buffer");
        require(bidId < bids.length, "Invalid bid");

        Bid storage bid = bids[bidId];
        require(bid.state == BidState.ACTIVE, "Not active");
        require(bid.bidder == msg.sender, "Not bidder");

        bid.state = BidState.CANCELED;
        bid.canceledAt = uint(block.timestamp);
        totalCanceledRefundsRemaining = totalCanceledRefundsRemaining + bid.budgetUSDST;
        activeBidCount = activeBidCount - 1;
        _removeActiveBudget(bid.maxPriceUSDST, bid.budgetUSDST);

        emit BidCanceled(bidId, msg.sender, bid.budgetUSDST, bid.canceledAt);
    }

    // Withdraw canceled bid refund after delay.
    function withdrawCanceled(uint bidId) external {
        require(bidId < bids.length, "Invalid bid");
        Bid storage bid = bids[bidId];
        require(bid.state == BidState.CANCELED, "Not canceled");
        require(bid.bidder == msg.sender, "Not bidder");
        require(!bid.canceledRefundWithdrawn, "Already withdrawn");
        require(block.timestamp >= bid.canceledAt + withdrawDelay, "Delay");
        require(block.timestamp < closeBufferStart || block.timestamp >= endTime, "Close buffer");

        bid.canceledRefundWithdrawn = true;
        totalCanceledRefundsRemaining = totalCanceledRefundsRemaining - bid.budgetUSDST;
        require(usdToken.transfer(msg.sender, bid.budgetUSDST), "USDST transfer failed");

        emit RefundWithdrawn(bidId, msg.sender, bid.budgetUSDST, RefundReason.BID_CANCELED);
    }

    // Cancel the auction before the close buffer window.
    function cancelAuction() external onlyOwner {
        require(auctionStarted, "Not started");
        require(!auctionCanceled, "Already canceled");
        require(!finalized, "Finalized");
        require(block.timestamp < closeBufferStart, "Close buffer");

        auctionCanceled = true;
        cancelTime = uint(block.timestamp);
        emit AuctionCanceled(cancelTime);
    }

    // Withdraw funds after an auction-wide cancel.
    // No withdrawDelay is enforced here — once the auction is canceled,
    // the front-running risk that the delay guards against no longer applies.
    // For ACTIVE bids, totalCanceledRefundsRemaining is incremented then
    // immediately decremented (net zero) to maintain accounting consistency.
    function withdrawAfterCancel(uint bidId) external {
        require(auctionCanceled, "Not canceled");
        require(bidId < bids.length, "Invalid bid");

        Bid storage bid = bids[bidId];
        require(bid.bidder == msg.sender, "Not bidder");
        require(!bid.canceledRefundWithdrawn, "Already withdrawn");

        if (bid.state == BidState.ACTIVE) {
            bid.state = BidState.CANCELED;
            bid.canceledAt = cancelTime;
            totalCanceledRefundsRemaining = totalCanceledRefundsRemaining + bid.budgetUSDST;
            activeBidCount = activeBidCount - 1;
            _removeActiveBudget(bid.maxPriceUSDST, bid.budgetUSDST);
        }

        require(bid.state == BidState.CANCELED, "Not canceled");
        bid.canceledRefundWithdrawn = true;
        totalCanceledRefundsRemaining = totalCanceledRefundsRemaining - bid.budgetUSDST;
        require(usdToken.transfer(msg.sender, bid.budgetUSDST), "USDST transfer failed");

        emit RefundWithdrawn(bidId, msg.sender, bid.budgetUSDST, RefundReason.AUCTION_CANCELED);
    }

    // Phase 1 finalize: computes and stores clearing price.
    // Permissionless — anyone may call to advance auction state.
    function finalizePrice() external {
        _finalizePriceInternal();
    }

    // Phase 2 finalize: computes allocations/refunds and closes auction.
    // Permissionless — anyone may call to advance auction state.
    function finalizeAllocations() external {
        _finalizeAllocationsBatchInternal(bids.length);
    }

    // Batched phase-2 finalize for large auctions.
    function finalizeAllocationsBatch(uint maxCount) external {
        _finalizeAllocationsBatchInternal(maxCount);
    }

    // Admin recovery helper: restart batched allocation stages in-place
    // for the current price-finalized auction.
    // Safe because !finalized guarantees no distributions, refund
    // withdrawals, or vaulting have occurred — all require finalized == true.
    // Resetting totalVaultedBaseTokens to 0 is therefore a no-op.
    function restartFinalizeAllocations() external onlyOwner {
        require(priceFinalized, "Price not finalized");
        require(!finalized, "Finalized");

        // Revert any bids that stage 3 already transitioned so the
        // replay in stages 0-2 (which filter on ACTIVE) sees them.
        uint i;
        for (i = 0; i < bids.length; i++) {
            Bid storage bid = bids[i];
            if (bid.state == BidState.FINALIZED) {
                bid.state = BidState.ACTIVE;
            }
        }

        allocationStage = 0;
        allocationCursor = 0;
        totalVaultedBaseTokens = 0;
    }

    // Progress helper for batched finalize operations.
    function finalizeProgress() external view returns (uint stage, uint cursor, uint totalBids, bool done) {
        return (allocationStage, allocationCursor, bids.length, finalized);
    }

    // Scan for the next undistributed bid starting from `start`.
    // Scans at most `maxScan` bids.  Returns (bidId, true) if found,
    // or (0, false) if none found within range.
    function nextUndistributedFrom(uint start, uint maxScan) external view returns (uint bidId, bool found) {
        uint end = start + maxScan;
        if (end > bids.length) {
            end = bids.length;
        }
        uint i;
        for (i = start; i < end; i++) {
            if (!bids[i].distributed && bids[i].tokensCapped > 0) {
                return (i, true);
            }
        }
        return (0, false);
    }

    // Ops sanity check: actual STRATO balance vs tracked reserves.
    // Returns (balance, trackedReserves).  balance >= trackedReserves is
    // expected to hold unless tokens were moved out by governance or external error.
    // Note: trackedReserves covers the three logical reserve partitions only
    // (claim, bonus, LP) — not vaulted obligations (see vaultedBaseObligations).
    function escrowHealth() external view returns (uint balance, uint trackedReserves) {
        balance = stratoToken.balanceOf(address(this));
        trackedReserves = claimReserveRemaining + bonusTokenReserveRemaining + lpTokenReserve;
    }

    // Ops view: base-token obligations from vaulted bids.
    // When pendingDistributions == 0, this is the only claim against
    // claimReserveRemaining.  Useful for auditing why burnUnsold
    // passes or fails (_requiredClaimReserve = burn + this value).
    function vaultedBaseObligations() external view returns (uint) {
        return totalVaultedBaseTokens;
    }

    // Backwards-compatible finalize wrapper (runs both phases).
    function finalize() external {
        require(!priceFinalized || !finalized, "Auction already finalized");
        if (!priceFinalized) {
            _finalizePriceInternal();
        }
        if (!finalized) {
            _finalizeAllocationsBatchInternal((bids.length + 1) * 6);
        }
    }

    function _finalizePriceInternal() internal {
        require(auctionStarted, "Not started");
        require(!auctionCanceled, "Auction canceled");
        require(!finalized, "Finalized");
        require(!priceFinalized, "Price finalized");
        require(block.timestamp >= endTime, "Auction ongoing");

        finalizeTime = uint(block.timestamp);

        if (activeBidCount == 0) {
            // All bids are already CANCELED with refunds handled via withdrawCanceled/withdrawAfterCancel.
            // No per-bid finalize/refund bookkeeping is needed here, so we can safely mark finalized.
            clearingPrice = 0;
            success = false;
            demandClearsSupply = false;
            raisedUncappedUSDST = 0;
            raisedUSDST = 0;
            unsoldTokens = saleSupply;
            _assertNoActiveBids();
            finalized = true;
            emit Finalized(clearingPrice, raisedUSDST, success);
            return;
        }

        demandClearsSupply = false;
        uint price = _computeClearingPrice();
        if (price == 0) {
            // Edge case: activeBidCount > 0 but no viable price levels
            // (e.g. all budget drained by cancellations leaving stale count).
            // Treat as failed auction.  Set priceFinalized with success=false
            // so the existing batched allocation stages (stage 3) will
            // finalize each ACTIVE bid with a full refund, one per cursor
            // step — no O(N) loop needed here.
            clearingPrice = 0;
            success = false;
            raisedUncappedUSDST = 0;
            raisedUSDST = 0;
            unsoldTokens = saleSupply;
            // Fall through: priceFinalized = true below will let
            // finalizeAllocationsBatch process bids in batches.
            // Stage 3 handles !success → full refund per bid.
        }
        if (price > 0) {
            clearingPrice = price;
        }
        priceFinalized = true;
    }

    function _finalizeAllocationsBatchInternal(uint maxCount) internal {
        require(maxCount > 0, "Invalid count");
        require(auctionStarted, "Not started");
        require(!auctionCanceled, "Auction canceled");
        require(!finalized, "Finalized");
        require(priceFinalized, "Price not finalized");
        if (allocationStage == 0 && allocationCursor == 0) {
            _initializeAllocationStages();
        }

        uint stageBefore = allocationStage;
        uint cursorBefore = allocationCursor;
        uint processed = 0;
        while (processed < maxCount && !finalized) {
            if (allocationStage == 0) {
                _processStageZeroCursor();
            } else if (allocationStage == 1) {
                _processStageOneCursor();
            } else if (allocationStage == 2) {
                _processStageTwoCursor();
            } else if (allocationStage == 4) {
                _processStageFourBonusDemandCursor();
            } else if (allocationStage == 5) {
                _processStageFiveBonusAllocateCursor();
            } else {
                _processStageThreeCursor();
            }
            processed = processed + 1;
        }
        emit FinalizeBatchProgress(stageBefore, cursorBefore, allocationStage, allocationCursor, processed);
    }

    function _initializeAllocationStages() internal {
        allocationTotalTokensAbove = 0;
        allocationTotalDemandAt = 0;
        allocationRemainingSupply = 0;
        allocationApplyCap = false;
        allocationRaisedTmp = 0;
        allocationTotalAllocatedTmp = 0;
        bonusStageTotalDemand = 0;
        raisedUncappedUSDST = 0;
        totalRefundsRemaining = 0;
        pendingDistributions = 0;
        nextDistributionIndex = 0;
        allocationCursor = 0;
        if (clearingPrice == 0) {
            // Skip stages 0-2 (they divide by clearingPrice).
            // Go straight to stage 3 which finalizes all ACTIVE bids
            // with full refunds when success == false.
            allocationStage = 3;
        } else {
            allocationStage = 0;
        }
    }

    function _processStageZeroCursor() internal {
        if (allocationCursor >= bids.length) {
            if (saleSupply > allocationTotalTokensAbove) {
                allocationRemainingSupply = saleSupply - allocationTotalTokensAbove;
            } else {
                allocationRemainingSupply = 0;
            }
            allocationStage = 1;
            allocationCursor = 0;
            return;
        }
        Bid storage bid = bids[allocationCursor];
        if (bid.state != BidState.ACTIVE) {
            allocationCursor = allocationCursor + 1;
            return;
        }
        uint baseTokens = _tokensFromBudget(bid.budgetUSDST, clearingPrice);
        if (bid.maxPriceUSDST > clearingPrice) {
            allocationTotalTokensAbove = allocationTotalTokensAbove + baseTokens;
        } else if (bid.maxPriceUSDST == clearingPrice) {
            allocationTotalDemandAt = allocationTotalDemandAt + baseTokens;
        }
        allocationCursor = allocationCursor + 1;
    }

    // Stage 1: compute tokensUncapped per bid and accumulate raisedUncappedUSDST.
    //
    // Design choice — "cap after supply allocation":
    //   tokensUncapped already reflects supply-proration (above-P* pro-rata,
    //   remainder to at-P* bids).  raisedUncappedUSDST is therefore the total
    //   proceeds *given the supply constraint but before the maxRaise cap*.
    //   Stage 2 then applies maxRaise scaling on top of these supply-fair
    //   allocations.  This is intentional: the maxRaise cap only binds when
    //   selling the full supply at P* would exceed maxRaiseUSDST, and scales
    //   every bidder uniformly from that baseline.
    function _processStageOneCursor() internal {
        if (allocationCursor >= bids.length) {
            allocationApplyCap = maxRaiseUSDST > 0 && raisedUncappedUSDST > maxRaiseUSDST;
            allocationStage = 2;
            allocationCursor = 0;
            return;
        }
        Bid storage bid = bids[allocationCursor];
        if (bid.state == BidState.ACTIVE) {
            uint baseTokens = _tokensFromBudget(bid.budgetUSDST, clearingPrice);
            uint uncapped = 0;
            if (bid.maxPriceUSDST > clearingPrice) {
                if (allocationTotalTokensAbove > saleSupply && allocationTotalTokensAbove > 0) {
                    uncapped = (baseTokens * saleSupply) / allocationTotalTokensAbove;
                } else {
                    uncapped = baseTokens;
                }
            } else if (bid.maxPriceUSDST == clearingPrice) {
                if (!demandClearsSupply) {
                    // Undersubscribed: all eligible bids should receive their
                    // full budget-derived tokens at the clearing price.
                    uncapped = baseTokens;
                } else if (allocationTotalTokensAbove > saleSupply) {
                    uncapped = 0;
                } else if (allocationTotalDemandAt > 0) {
                    uint scaled = (allocationRemainingSupply * baseTokens) / allocationTotalDemandAt;
                    // Guard against aggregate-vs-per-bid rounding mismatch:
                    // never allocate more than this bid's budget-derived tokens.
                    uncapped = scaled > baseTokens ? baseTokens : scaled;
                }
            }
            bid.tokensUncapped = uncapped;
            raisedUncappedUSDST = raisedUncappedUSDST + _spentFromTokens(uncapped, clearingPrice);
        }
        allocationCursor = allocationCursor + 1;
    }

    function _processStageTwoCursor() internal {
        if (allocationCursor >= bids.length) {
            // Use the actual accumulated per-bid spend (allocationRaisedTmp)
            // for both the success check and raisedUSDST.  This avoids:
            //   - overstating proceeds when maxRaise cap scales down allocations,
            //   - aggregate-vs-per-bid rounding mismatch (floor(Σ) ≠ Σ floor).
            if (allocationRaisedTmp >= minRaiseUSDST) {
                success = true;
                raisedUSDST = allocationRaisedTmp;
                totalAllocated = allocationTotalAllocatedTmp;
                if (saleSupply > totalAllocated) {
                    unsoldTokens = saleSupply - totalAllocated;
                } else {
                    unsoldTokens = 0;
                }
            } else {
                success = false;
                raisedUSDST = 0;
                totalAllocated = 0;
                unsoldTokens = saleSupply;
            }
            allocationStage = 3;
            allocationCursor = 0;
            return;
        }
        Bid storage bid = bids[allocationCursor];
        if (bid.state == BidState.ACTIVE) {
            uint capped = bid.tokensUncapped;
            if (allocationApplyCap && raisedUncappedUSDST > 0) {
                capped = (bid.tokensUncapped * maxRaiseUSDST) / raisedUncappedUSDST;
            }
            // Safety cap: a bid can never spend more than its own budget
            // at the clearing price, regardless of upstream rounding.
            uint affordable = _tokensFromBudget(bid.budgetUSDST, clearingPrice);
            if (capped > affordable) {
                capped = affordable;
            }
            bid.tokensCapped = capped;
            bid.spentUSDST = _spentFromTokens(capped, clearingPrice);
            bid.refundUSDST = bid.budgetUSDST - bid.spentUSDST;
            allocationTotalAllocatedTmp = allocationTotalAllocatedTmp + capped;
            allocationRaisedTmp = allocationRaisedTmp + bid.spentUSDST;
        }
        allocationCursor = allocationCursor + 1;
    }

    function _processStageThreeCursor() internal {
        if (allocationCursor >= bids.length) {
            if (success) {
                bonusStageTotalDemand = 0;
                allocationStage = 4;
                allocationCursor = 0;
                return;
            }
            demandClearsSupply = false;
            allocationStage = 0;
            allocationCursor = 0;
            allocationTotalTokensAbove = 0;
            allocationTotalDemandAt = 0;
            allocationRemainingSupply = 0;
            allocationApplyCap = false;
            allocationRaisedTmp = 0;
            allocationTotalAllocatedTmp = 0;
            bonusStageTotalDemand = 0;
            activeBidCount = 0;
            _assertNoActiveBids();
            finalized = true;
            emit Finalized(clearingPrice, raisedUSDST, success);
            return;
        }
        Bid storage bid = bids[allocationCursor];
        if (bid.state == BidState.ACTIVE) {
            bid.state = BidState.FINALIZED;
            if (!success) {
                bid.tokensCapped = 0;
                bid.spentUSDST = 0;
                bid.refundUSDST = bid.budgetUSDST;
            }
            totalRefundsRemaining += bid.refundUSDST;
            if (success && bid.tokensCapped > 0) {
                pendingDistributions = pendingDistributions + 1;
            }
            emit BidFinalized(allocationCursor, bid.bidder, bid.tokensCapped, bid.spentUSDST, bid.refundUSDST);
        }
        allocationCursor = allocationCursor + 1;
    }

    function _processStageFourBonusDemandCursor() internal {
        if (allocationCursor >= bids.length) {
            allocationStage = 5;
            allocationCursor = 0;
            return;
        }
        Bid storage bid = bids[allocationCursor];
        if (bid.state == BidState.FINALIZED) {
            bid.bonusTokens = 0;
            uint cutoff = startTime + tier1WindowSeconds;
            if (bid.tokensCapped > 0 && bid.createdAt < cutoff) {
                bonusStageTotalDemand = bonusStageTotalDemand + bid.tokensCapped;
            }
        }
        allocationCursor = allocationCursor + 1;
    }

    function _processStageFiveBonusAllocateCursor() internal {
        if (allocationCursor >= bids.length) {
            bonusTokenReserveRemaining = bonusTokenReserve;
            _computeBuckets();
            allocationStage = 0;
            allocationCursor = 0;
            allocationTotalTokensAbove = 0;
            allocationTotalDemandAt = 0;
            allocationRemainingSupply = 0;
            allocationApplyCap = false;
            allocationRaisedTmp = 0;
            allocationTotalAllocatedTmp = 0;
            bonusStageTotalDemand = 0;
            activeBidCount = 0;
            _assertNoActiveBids();
            finalized = true;
            emit Finalized(clearingPrice, raisedUSDST, success);
            return;
        }
        Bid storage bid = bids[allocationCursor];
        if (bid.state == BidState.FINALIZED && bonusStageTotalDemand > 0 && bonusTokenReserve > 0) {
            uint cutoff = startTime + tier1WindowSeconds;
            if (bid.tokensCapped > 0 && bid.createdAt < cutoff) {
                bid.bonusTokens = (bonusTokenReserve * bid.tokensCapped) / bonusStageTotalDemand;
            }
        }
        allocationCursor = allocationCursor + 1;
    }

    // Internal: attempt to distribute a single bid's allocation.
    // Returns: 0 = transfer failed (bid still pending),
    //          1 = distributed successfully,
    //          2 = vaulted (max attempts reached).
    // countAttempts: only true for bidder/owner callers (prevents griefing).
    function _attemptDistribute(uint bidId, Bid storage bid, bool countAttempts) internal returns (uint) {
        uint baseTokens = bid.tokensCapped;
        uint bonusTokens = bid.bonusTokens;
        uint totalSent = baseTokens + bonusTokens;
        bid.distributed = true;
        bool transferOk = true;
        if (claimReserveRemaining < baseTokens || bonusTokenReserveRemaining < bonusTokens) {
            transferOk = false;
        } else {
            try stratoToken.transfer(bid.bidder, totalSent) returns (bool ok) {
                if (!ok) {
                    transferOk = false;
                }
            } catch {
                transferOk = false;
            }
        }

        if (transferOk) {
            claimReserveRemaining = claimReserveRemaining - baseTokens;
            bonusTokenReserveRemaining = bonusTokenReserveRemaining - bonusTokens;
            bid.tokensDistributed = totalSent;
            pendingDistributions = pendingDistributions - 1;
            emit DistributionProcessed(bidId, bid.bidder, totalSent);
            return 1;
        }

        bid.distributed = false;
        if (countAttempts) {
            bid.distributionAttempts = bid.distributionAttempts + 1;
            if (bid.distributionAttempts >= maxDistributionAttempts) {
                bid.distributed = true;
                bid.distributionVaulted = true;
                bid.vaultedImmediate = baseTokens;
                bid.vaultedBonusTokens = bonusTokens;
                totalVaultedBaseTokens = totalVaultedBaseTokens + baseTokens;
                pendingDistributions = pendingDistributions - 1;
                emit DistributionVaulted(bidId, bid.bidder, totalSent);
                return 2;
            }
        }
        if (countAttempts) {
            emit DistributionFailed(bidId, bid.bidder);
        }
        return 0;
    }

    // Distribute allocations for a batch of bid IDs.
    // Transfers full allocations (base + bonus) from escrow to winners.
    // May be called immediately after finalization; tokens are non-transferable
    // until TGE unpauses the transfer lock.
    function distributeBatch(uint[] bidIds) external {
        require(finalized, "Not finalized");
        require(success, "Not successful");
        require(!auctionCanceled, "Auction canceled");
        require(!unwound, "Unwound");
        require(unwindPhase == 0, "Unwind in progress");

        bool countAttempts = (msg.sender == owner());
        uint i;
        for (i = 0; i < bidIds.length; i++) {
            uint bidId = bidIds[i];
            require(bidId < bids.length, "Invalid bid");
            Bid storage bid = bids[bidId];
            if (bid.distributed) {
                continue;
            }
            if (bid.tokensCapped == 0) {
                bid.distributed = true;
                continue;
            }
            bool isBidder = (msg.sender == bid.bidder);
            _attemptDistribute(bidId, bid, countAttempts || isBidder);
        }
    }

    // Distribute the next `maxCount` bids in order, starting from the cursor.
    //
    // Failure handling:
    //   - Bidder / owner: increments attempts, breaks on retryable failure
    //     so next call retries the same bid.
    //   - Third party: skips the failing bid and continues, so anyone can
    //     help distribute without getting stuck on a temporarily failing bid.
    //     Attempt counter is NOT incremented to prevent griefing.
    function distributeNext(uint maxCount) external {
        require(finalized, "Not finalized");
        require(success, "Not successful");
        require(!auctionCanceled, "Auction canceled");
        require(!unwound, "Unwound");
        require(unwindPhase == 0, "Unwind in progress");
        require(maxCount > 0, "Invalid count");

        bool isOwner = (msg.sender == owner());
        uint i = nextDistributionIndex;
        uint processed = 0;
        while (i < bids.length && processed < maxCount) {
            Bid storage bid = bids[i];
            if (!bid.distributed) {
                if (bid.tokensCapped == 0) {
                    bid.distributed = true;
                } else {
                    bool isBidder = (msg.sender == bid.bidder);
                    bool countAttempts = isOwner || isBidder;
                    uint result = _attemptDistribute(i, bid, countAttempts);
                    if (result >= 1) {
                        // Distributed or vaulted — count as processed.
                        processed = processed + 1;
                    } else if (countAttempts) {
                        // Bidder/owner: break to retry this bid next call.
                        break;
                    }
                    // Third party: skip (no break), cursor advances.
                }
            }

            i = i + 1;
        }

        nextDistributionIndex = i;
    }

    // Retry distribution for a single bid that was skipped by distributeNext
    // (cursor advanced past it) or failed in distributeBatch.  Same attempt-
    // count rules: only bidder/owner increments attempts.
    function retryDistributeBid(uint bidId) external {
        require(finalized, "Not finalized");
        require(success, "Not successful");
        require(!auctionCanceled, "Auction canceled");
        require(!unwound, "Unwound");
        require(unwindPhase == 0, "Unwind in progress");
        require(bidId < bids.length, "Invalid bid");

        Bid storage bid = bids[bidId];
        require(!bid.distributed, "Already distributed");
        require(!bid.distributionVaulted, "Vaulted");
        require(bid.tokensDistributed == 0, "Already sent");
        require(bid.tokensCapped > 0, "No allocation");

        bool countAttempts = (msg.sender == bid.bidder || msg.sender == owner());
        _attemptDistribute(bidId, bid, countAttempts);
    }

    // Withdraw finalized refund after allocations are computed.
    // Available regardless of TGE timing or unwind state.
    function withdrawRefund(uint bidId) external {
        require(finalized, "Not finalized");
        require(bidId < bids.length, "Invalid bid");

        Bid storage bid = bids[bidId];
        require(bid.bidder == msg.sender, "Not bidder");
        require(bid.state == BidState.FINALIZED, "Not finalized");
        require(!bid.finalizedRefundWithdrawn, "Already withdrawn");
        require(bid.refundUSDST > 0, "No refund");

        bid.finalizedRefundWithdrawn = true;
        totalRefundsRemaining = totalRefundsRemaining - bid.refundUSDST;
        require(usdToken.transfer(msg.sender, bid.refundUSDST), "USDST transfer failed");

        emit RefundWithdrawn(bidId, msg.sender, bid.refundUSDST, RefundReason.FINALIZED);
    }

    // Withdraw immediate tokens vaulted due to distribution failures.
    function withdrawVaultedImmediate(uint bidId) external {
        require(!unwound, "Unwound");
        require(unwindPhase == 0, "Unwind in progress");
        require(bidId < bids.length, "Invalid bid");
        Bid storage bid = bids[bidId];
        require(bid.bidder == msg.sender, "Not bidder");
        require(bid.distributionVaulted, "Not vaulted");
        require(bid.vaultedImmediate > 0 || bid.vaultedBonusTokens > 0, "No tokens");

        uint baseAmount = bid.vaultedImmediate;
        uint bonusAmount = bid.vaultedBonusTokens;
        uint amount = baseAmount + bonusAmount;
        bid.vaultedImmediate = 0;
        bid.vaultedBonusTokens = 0;
        bid.tokensDistributed = amount;
        totalVaultedBaseTokens = totalVaultedBaseTokens - baseAmount;
        require(claimReserveRemaining >= baseAmount, "Claim reserve exhausted");
        require(bonusTokenReserveRemaining >= bonusAmount, "Bonus reserve exhausted");
        claimReserveRemaining = claimReserveRemaining - baseAmount;
        bonusTokenReserveRemaining = bonusTokenReserveRemaining - bonusAmount;
        require(stratoToken.transfer(msg.sender, amount), "STRATO transfer failed");
        emit VaultedImmediateWithdrawn(bidId, msg.sender, amount);
    }

    // Burn unsold base tokens after a successful auction.
    function burnUnsold() external {
        require(finalized, "Not finalized");
        require(success, "Not successful");
        require(!unwound, "Unwound");
        require(unwindPhase == 0, "Unwind in progress");
        require(pendingDistributions == 0, "Distributions pending");
        require(unsoldTokens > 0, "No unsold");

        uint amount = unsoldTokens;
        unsoldTokens = 0;
        require(claimReserveRemaining >= _requiredClaimReserve(amount), "Claim reserve insufficient");
        require(claimReserveRemaining >= amount, "Claim reserve exhausted");
        claimReserveRemaining = claimReserveRemaining - amount;
        stratoToken.burn(address(this), amount);
        emit UnsoldBurned(amount);
    }

    // Burn remaining bonus tokens (rounding dust or full reserve if
    // no bonus-window bids won). Callable after all distributions complete.
    function burnRemainingBonus() external {
        require(finalized, "Not finalized");
        require(success, "Not successful");
        require(!unwound, "Unwound");
        require(unwindPhase == 0, "Unwind in progress");
        require(pendingDistributions == 0, "Distributions pending");
        require(bonusTokenReserveRemaining > 0, "No bonus remaining");

        uint amount = bonusTokenReserveRemaining;
        bonusTokenReserveRemaining = 0;
        stratoToken.burn(address(this), amount);
        emit BonusBurned(amount);
    }

    // Schedule a TGE timestamp.
    function setTgeTime(uint newTgeTime) external onlyOwner {
        require(finalized, "Not finalized");
        require(success, "Not successful");
        require(!tgeExecuted, "TGE executed");
        require(!unwound, "Unwound");
        require(unwindPhase == 0, "Unwind in progress");
        tgeTime = newTgeTime;
        emit TgeScheduled(newTgeTime);
    }

    // Execute TGE: seed LP, unlock transfer lock, and release funds.
    // Requires all distributions to be complete and TGE time reached.
    //
    // NOTE: tgeExecuted is set AFTER all external calls succeed.
    // Because onlyOwner may route through AdminRegistry.castVoteOnIssue()
    // which uses _target.call(), a partial execution that does not
    // properly revert could leave state inconsistent if tgeExecuted
    // were set early.  Placing it last ensures the flag is only set
    // on full success.
    function executeTGE() external onlyOwner {
        require(finalized, "Not finalized");
        require(success, "Not successful");
        require(!tgeExecuted, "TGE executed");
        require(!unwound, "Unwound");
        require(unwindPhase == 0, "Unwind in progress");
        require(tgeTime != 0, "TGE not set");
        require(block.timestamp >= tgeTime, "TGE time");
        require(pendingDistributions == 0, "Distribution incomplete");

        uint lpStratoRequired = 0;
        if (lpUSDST > 0) {
            lpStratoRequired = _ceilDiv(lpUSDST * tokenUnit, clearingPrice);
            require(lpTokenReserve >= lpStratoRequired, "LP STRATO shortfall");
            lpTokenReserve = lpTokenReserve - lpStratoRequired;
            require(lpSeeder != address(0), "LP seeder missing");
            require(lpTokenLockVault != address(0), "LP lock vault missing");
            require(usdToken.transfer(lpSeeder, lpUSDST), "LP USDST transfer failed");
            require(stratoToken.transfer(lpSeeder, lpStratoRequired), "LP STRATO transfer failed");
            (address lpToken, uint lpTokensMinted) = ILpSeeder(lpSeeder).seedAndLock(lpUSDST, lpStratoRequired, clearingPrice, lpTokenLockVault);
            require(lpToken != address(0), "LP token missing");
            require(lpTokensMinted > 0, "LP tokens missing");
            if (!LpTokenLockVault(lpTokenLockVault).initialized()) {
                LpTokenLockVault(lpTokenLockVault).initialize(lpToken, treasuryWallet, tgeTime);
            }
            LpTokenLockVault(lpTokenLockVault).recordLock(lpTokensMinted);
        }

        if (transferLockController != address(0)) {
            ITransferLock(transferLockController).unpause();
        }

        if (treasuryUSDST > preTgeWithdrawn) {
            uint treasuryToSend = treasuryUSDST - preTgeWithdrawn;
            require(usdToken.transfer(treasuryWallet, treasuryToSend), "Treasury transfer failed");
        }
        if (reserveUSDST > 0) {
            require(usdToken.transfer(reserveWallet, reserveUSDST), "Reserve transfer failed");
        }

        // Set last: all external calls above are require()-guarded, so
        // reaching here guarantees full TGE completion.
        tgeExecuted = true;

        emit TgeExecuted(tgeTime, lpUSDST, lpStratoRequired, treasuryUSDST, reserveUSDST);
    }

    // Optional pre-TGE treasury withdrawal subject to cap.
    function withdrawTreasuryPreTge(uint amount) external onlyOwner {
        require(finalized, "Not finalized");
        require(success, "Not successful");
        require(!tgeExecuted, "TGE executed");
        require(!unwound, "Unwound");
        require(unwindPhase == 0, "Unwind in progress");
        require(preTgeWithdrawBps > 0, "Pre-TGE disabled");

        uint maxAmount = (treasuryUSDST * preTgeWithdrawBps) / 10000;
        require(preTgeWithdrawn + amount <= maxAmount, "Pre-TGE cap");
        preTgeWithdrawn = preTgeWithdrawn + amount;
        require(usdToken.transfer(treasuryWallet, amount), "Treasury transfer failed");
        emit PreTgeTreasuryWithdrawn(amount);
    }

    // Whether TGE delay has triggered resolution mode.
    function inResolutionMode() public view returns (bool) {
        if (!finalized || !success) return false;
        if (maxTgeDelay == 0) return false;
        return uint(block.timestamp) > finalizeTime + maxTgeDelay;
    }

    // Initiate unwind when TGE is delayed beyond maxTgeDelay.
    // After calling this, process bids with unwindBatch(), then
    // call finalizeUnwind() to complete.
    function unwind() external onlyOwner {
        require(finalized, "Not finalized");
        require(success, "Not successful");
        require(!tgeExecuted, "TGE executed");
        require(!unwound, "Already unwound");
        require(unwindPhase == 0, "Unwind already started");
        require(inResolutionMode(), "Not in resolution");

        unwindPhase = 1;
        unwindCursor = 0;
    }

    // Batched unwind: burns distributed tokens and zeros vaulted balances.
    // Call repeatedly until unwindCursor >= bids.length.
    //
    // Burn resilience: if a burn fails (bidder moved tokens away due to
    // whitelist mistake, early unpause, etc.), tokensDistributed is
    // restored so the bid remains retryable.  UnwindBurnFailed is
    // emitted for off-chain tracking.  The cursor still advances so the
    // batch doesn't stall.  withdrawUnwound gates on tokensDistributed
    // == 0, preventing double-payout (tokens + USDST) for failed burns.
    function unwindBatch(uint maxCount) external {
        require(unwindPhase == 1, "Not unwinding");
        require(maxCount > 0, "Invalid count");

        uint processed = 0;
        uint i = unwindCursor;
        while (i < bids.length && processed < maxCount) {
            Bid storage bid = bids[i];
            if (bid.state == BidState.FINALIZED) {
                // Burn tokens already distributed to bidders.
                if (bid.distributed && bid.tokensDistributed > 0) {
                    uint burnAmount = bid.tokensDistributed;
                    try stratoToken.burn(bid.bidder, burnAmount) {
                        bid.tokensDistributed = 0;
                    } catch {
                        // Burn failed — leave tokensDistributed intact so
                        // retryUnwindBurn() can retry and withdrawUnwound()
                        // remains blocked for this bid.
                        emit UnwindBurnFailed(i, bid.bidder, burnAmount);
                    }
                }
                // Zero vaulted balances (tokens still held by this contract).
                // Guarded subtract: if totalVaultedBaseTokens drifted (e.g. after
                // proxy upgrade), clamp to 0 instead of reverting so unwind isn't blocked.
                if (bid.distributionVaulted) {
                    if (bid.vaultedImmediate >= totalVaultedBaseTokens) {
                        totalVaultedBaseTokens = 0;
                    } else {
                        totalVaultedBaseTokens = totalVaultedBaseTokens - bid.vaultedImmediate;
                    }
                    bid.vaultedImmediate = 0;
                    bid.vaultedBonusTokens = 0;
                }
            }
            i = i + 1;
            processed = processed + 1;
        }
        unwindCursor = i;
    }

    // Retry burn for a specific bid whose burn failed during unwindBatch.
    // Restricted to owner or bidder to prevent spam.  Only zeroes
    // tokensDistributed on success, unblocking withdrawUnwound for this bid.
    //
    // POLICY: If a bidder moved tokens away (violating the transfer lock),
    // their burn will fail permanently and withdrawUnwound remains blocked.
    // This is intentional — bidders who circumvent the lock forfeit their
    // pro-rata unwind USDST.  The tokens they moved away are their loss.
    function retryUnwindBurn(uint bidId) external {
        require(unwindPhase == 1 || unwound, "Not unwinding");
        require(bidId < bids.length, "Invalid bid");
        Bid storage bid = bids[bidId];
        require(msg.sender == bid.bidder || msg.sender == owner(), "Not authorized");
        require(bid.state == BidState.FINALIZED, "Not finalized");
        require(bid.tokensDistributed > 0, "Nothing to burn");

        uint burnAmount = bid.tokensDistributed;
        stratoToken.burn(bid.bidder, burnAmount);
        bid.tokensDistributed = 0;
        emit UnwindBurnRetried(bidId, bid.bidder, burnAmount);
    }

    // Complete the unwind after all bids have been processed.
    // Burns undistributed reserves and computes pro-rata USDST pool.
    // Finalized refunds remain independently withdrawable.
    //
    // NOTE: Does NOT require all burns to have succeeded.  Bids with
    // failed burns (tokensDistributed > 0) can still be retried via
    // retryUnwindBurn() after finalization.  withdrawUnwound() gates
    // on tokensDistributed == 0 per-bid, so no double-payout occurs.
    function finalizeUnwind() external onlyOwner {
        require(unwindPhase == 1, "Not unwinding");
        require(unwindCursor >= bids.length, "Batch incomplete");

        // Burn undistributed participant escrow and remaining bonus.
        if (claimReserveRemaining > 0) {
            uint claimBurn = claimReserveRemaining;
            claimReserveRemaining = 0;
            stratoToken.burn(address(this), claimBurn);
        }
        if (bonusTokenReserveRemaining > 0) {
            uint bonusBurn = bonusTokenReserveRemaining;
            bonusTokenReserveRemaining = 0;
            stratoToken.burn(address(this), bonusBurn);
        }

        // Compute USDST available for pro-rata unwind claims.
        // Finalized and canceled refunds remain independently withdrawable,
        // so they are excluded from the unwind pool.
        uint available = usdToken.balanceOf(address(this));
        uint refundable = totalRefundsRemaining + totalCanceledRefundsRemaining;
        if (available > refundable) {
            available = available - refundable;
        } else {
            available = 0;
        }

        unwound = true;
        unwindPhase = 0;
        unwindCursor = 0;
        unwindAvailableUSDST = available;
        unwindRaisedUSDST = raisedUSDST;
        require(unwindRaisedUSDST > 0, "No raised funds to unwind");

        emit Unwound(unwindAvailableUSDST, unwindRaisedUSDST);
    }

    // Withdraw pro-rata USDST after unwind, proportional to accepted spend.
    // Blocked if tokensDistributed > 0 (burn not yet completed for this bid)
    // to prevent double-payout.  Use retryUnwindBurn() first.
    function withdrawUnwound(uint bidId) external {
        require(unwound, "Not unwound");
        require(bidId < bids.length, "Invalid bid");
        Bid storage bid = bids[bidId];
        require(bid.bidder == msg.sender, "Not bidder");
        require(bid.state == BidState.FINALIZED, "Not finalized");
        require(bid.tokensDistributed == 0, "Burn incomplete");
        require(bid.spentUSDST > 0, "No spend");

        uint claimable = (bid.spentUSDST * unwindAvailableUSDST) / unwindRaisedUSDST;
        require(claimable > 0, "Nothing to withdraw");
        bid.spentUSDST = 0;
        require(usdToken.transfer(msg.sender, claimable), "USDST transfer failed");
    }

    // Reclaim LP reserve STRATO after unwind (LP will never be seeded).
    function reclaimLpReserve() external onlyOwner {
        require(unwound, "Not unwound");
        require(lpTokenReserve > 0, "No LP reserve");

        uint amount = lpTokenReserve;
        lpTokenReserve = 0;
        require(stratoToken.transfer(treasuryWallet, amount), "STRATO transfer failed");
        emit LpReserveReclaimed(amount);
    }

    // Recover escrowed STRATO after a failed auction.
    // All bidder refunds are handled via withdrawRefund; this reclaims
    // the token reserves (claim + LP + bonus) that have no other exit path.
    function recoverAfterFailure() external onlyOwner {
        require(finalized, "Not finalized");
        require(!success, "Auction succeeded");

        uint balance = stratoToken.balanceOf(address(this));
        if (balance > 0) {
            require(stratoToken.transfer(treasuryWallet, balance), "STRATO transfer failed");
        }
    }

    // Test-only reset of auction state (must be inactive).
    function resetForTesting() external onlyOwner {
        require(!auctionStarted || finalized || auctionCanceled, "Auction active");

        uint i;
        for (i = 0; i < bids.length; i++) {
            Bid storage bid = bids[i];
            address bidder = bid.bidder;
            if (bidder != address(0)) {
                uint j;
                for (j = 0; j < userBidIds[bidder].length; j++) {
                    userBidIds[bidder][j] = 0;
                }
                userBidIds[bidder].length = 0;
            }
            bid.bidder = address(0);
            bid.budgetUSDST = 0;
            bid.maxPriceUSDST = 0;
            bid.createdAt = 0;
            bid.canceledAt = 0;
            bid.state = BidState.NULL;
            bid.tier = 0;
                bid.tokensUncapped = 0;
            bid.tokensCapped = 0;
            bid.spentUSDST = 0;
            bid.refundUSDST = 0;
            bid.bonusTokens = 0;
            bid.distributed = false;
            bid.distributionVaulted = false;
            bid.canceledRefundWithdrawn = false;
            bid.finalizedRefundWithdrawn = false;
            bid.distributionAttempts = 0;
            bid.vaultedImmediate = 0;
            bid.vaultedBonusTokens = 0;
            bid.tokensDistributed = 0;
        }
        bids.length = 0;
        _clearActivePriceBuckets();

        auctionStarted = false;
        auctionCanceled = false;
        bidsPaused = false;
        activeBidCount = 0;
        startTime = 0;
        endTime = 0;
        closeBufferStart = 0;
        cancelTime = 0;

        finalized = false;
            success = false;
        priceFinalized = false;
        finalizeTime = 0;
        clearingPrice = 0;
        raisedUncappedUSDST = 0;
            raisedUSDST = 0;
        unsoldTokens = 0;
        totalAllocated = 0;

        lpUSDST = 0;
        treasuryUSDST = 0;
        reserveUSDST = 0;
        preTgeWithdrawn = 0;

        pendingDistributions = 0;
        totalRefundsRemaining = 0;
        totalCanceledRefundsRemaining = 0;
        totalVaultedBaseTokens = 0;

        tgeTime = 0;
        tgeExecuted = false;

        unwound = false;
        unwindAvailableUSDST = 0;
        unwindRaisedUSDST = 0;
        unwindPhase = 0;
        unwindCursor = 0;
        claimReserveRemaining = 0;
        nextDistributionIndex = 0;
        allocationStage = 0;
        allocationCursor = 0;
        allocationTotalTokensAbove = 0;
        allocationTotalDemandAt = 0;
        allocationRemainingSupply = 0;
        allocationApplyCap = false;
        allocationRaisedTmp = 0;
        allocationTotalAllocatedTmp = 0;
        bonusStageTotalDemand = 0;
    }

    // Rebuild active price buckets in batches after proxy upgrades.
    // Pass resetBuckets=true on the first call, then false for subsequent batches.
    //
    // OPERATIONALLY IMPORTANT: _assertNoActiveBids() checks
    // activeBidCount == 0.  If activeBidCount drifts (e.g. after a proxy
    // upgrade that shifts storage slots), finalization will revert.
    // Run this function to reconcile activeBidCount and
    // activeBudgetByPrice from bid-level state before retrying.
    // Use verifyNoActiveBids() to diagnose drift.
    function rebuildActivePriceBuckets(uint startId, uint maxCount, bool resetBuckets) external onlyOwner {
        require(!finalized, "Finalized");
        if (resetBuckets) {
            _clearActivePriceBuckets();
            activeBidCount = 0;
        }
        if (maxCount == 0) return;
        uint end = startId + maxCount;
        if (end > bids.length) {
            end = bids.length;
        }
        uint i;
        for (i = startId; i < end; i++) {
            Bid storage bid = bids[i];
            if (bid.state != BidState.ACTIVE) {
                continue;
            }
            activeBidCount = activeBidCount + 1;
            _addActiveBudget(bid.maxPriceUSDST, bid.budgetUSDST);
        }
    }

    // --- Internal functions ---

    // Compute proceeds buckets from cleared raise amount.
    // Rounding dust is added to treasury.
    function _computeBuckets() internal {
        lpUSDST = (raisedUSDST * lpBps) / 10000;
        treasuryUSDST = (raisedUSDST * treasuryBps) / 10000;
        reserveUSDST = (raisedUSDST * reserveBps) / 10000;
        uint allocated = lpUSDST + treasuryUSDST + reserveUSDST;
        if (raisedUSDST > allocated) {
            treasuryUSDST = treasuryUSDST + (raisedUSDST - allocated);
        }
    }

    // Resolve tier based on timestamp relative to auction start.
    function _tierForTimestamp(uint timestamp) internal view returns (uint) {
        uint tier1End = startTime + tier1WindowSeconds;
        uint tier2End = tier1End + tier2WindowSeconds;
        if (timestamp < tier1End) return 1;
        if (timestamp < tier2End) return 2;
        return 0;
    }

    // Minimum claim reserve needed to honor outstanding claims after a burn.
    // O(1) minimum claim reserve: only vaulted base tokens remain owed
    // when pendingDistributions == 0 (required by burnUnsold caller).
    function _requiredClaimReserve(uint additionalBurn) internal view returns (uint) {
        return additionalBurn + totalVaultedBaseTokens;
    }

    // Convert budget to token amount at a given price.
    function _tokensFromBudget(uint budgetUSDST, uint price) internal view returns (uint) {
        return (budgetUSDST * tokenUnit) / price;
    }

    // Convert token amount to USDST spent at a given price.
    function _spentFromTokens(uint tokens, uint price) internal view returns (uint) {
        return (tokens * price) / tokenUnit;
    }

    // Find the highest price level where cumulative demand >= saleSupply.
    // Sorts active (non-zero budget) price levels descending and accumulates
    // budget top-down. Returns the first level that clears, setting
    // demandClearsSupply = true. If no level clears, returns the lowest
    // active price level with demandClearsSupply = false (undersubscribed).
    // Returns 0 if no active price levels exist at all.
    // Note: tick alignment is enforced in placeBid, so all levels are
    // already on-tick; no ceil-to-tick is needed here.
    function _computeClearingPrice() internal returns (uint) {
        uint activeCount = 0;
        uint i;
        for (i = 0; i < activePriceLevels.length; i++) {
            if (activeBudgetByPrice[activePriceLevels[i]] > 0) {
                activeCount = activeCount + 1;
            }
        }
        if (activeCount == 0) {
            demandClearsSupply = false;
            return 0;
        }

        uint[] memory levels = new uint[](activeCount);
        uint idx = 0;
        for (i = 0; i < activePriceLevels.length; i++) {
            uint price = activePriceLevels[i];
            uint budgetAtPrice = activeBudgetByPrice[price];
            if (budgetAtPrice == 0) {
                continue;
            }
            levels[idx] = price;
            idx = idx + 1;
        }

        _quickSortDesc(levels, int(0), int(activeCount - 1));

        uint minPrice = levels[activeCount - 1];
        uint cumulativeBudget = 0;
        for (i = 0; i < activeCount; i++) {
            uint priceLevel = levels[i];
            uint budgetAtPrice = activeBudgetByPrice[priceLevel];
            cumulativeBudget = cumulativeBudget + budgetAtPrice;
            if (_tokensFromBudget(cumulativeBudget, priceLevel) >= saleSupply) {
                demandClearsSupply = true;
                return priceLevel;
            }
        }

        demandClearsSupply = false;
        return minPrice;
    }

    function _addActiveBudget(uint price, uint budget) internal {
        if (!hasActivePriceLevel[price]) {
            hasActivePriceLevel[price] = true;
            activePriceLevels.push(price);
        }
        activeBudgetByPrice[price] = activeBudgetByPrice[price] + budget;
    }

    function _removeActiveBudget(uint price, uint budget) internal {
        uint current = activeBudgetByPrice[price];
        if (budget >= current) {
            activeBudgetByPrice[price] = 0;
        } else {
            activeBudgetByPrice[price] = current - budget;
        }
    }

    function _clearActivePriceBuckets() internal {
        uint i;
        for (i = 0; i < activePriceLevels.length; i++) {
            uint price = activePriceLevels[i];
            activeBudgetByPrice[price] = 0;
            hasActivePriceLevel[price] = false;
            activePriceLevels[i] = 0;
        }
        activePriceLevels.length = 0;
    }

    function _quickSortDesc(uint[] memory arr, int left, int right) internal pure {
        while (left < right) {
            int i = left;
            int j = right;
            int mid = left + (right - left) / 2;
            uint a = arr[uint(left)];
            uint b = arr[uint(mid)];
            uint c = arr[uint(right)];
            uint pivot;
            // Median-of-three pivot selection for descending sort.
            if ((a >= b && a <= c) || (a <= b && a >= c)) {
                pivot = a;
            } else if ((b >= a && b <= c) || (b <= a && b >= c)) {
                pivot = b;
            } else {
                pivot = c;
            }
            while (i <= j) {
                while (arr[uint(i)] > pivot) {
                    i++;
                }
                while (arr[uint(j)] < pivot) {
                    j--;
                }
                if (i <= j) {
                    uint tmp = arr[uint(i)];
                    arr[uint(i)] = arr[uint(j)];
                    arr[uint(j)] = tmp;
                    i++;
                    j--;
                }
            }
            // Recurse into smaller partition first to keep stack depth low.
            if (j - left < right - i) {
                if (left < j) {
                    _quickSortDesc(arr, left, j);
                }
                left = i;
            } else {
                if (i < right) {
                    _quickSortDesc(arr, i, right);
                }
                right = j;
            }
        }
    }

    // Invariant: no ACTIVE bids may exist when finalized is set.
    // Called once per auction lifetime at each finalize site.
    //
    // O(1) invariant: activeBidCount must be zero before finalized is set.
    // If activeBidCount drifts (e.g. after a proxy upgrade), finalization
    // reverts until state is reconciled via rebuildActivePriceBuckets().
    function _assertNoActiveBids() internal view {
        require(activeBidCount == 0, "Active bids remain");
    }

    // Ops-only O(N) diagnostic: scan all bids to verify none are ACTIVE.
    // Use off-chain or via rebuildActivePriceBuckets to reconcile if this
    // returns false while activeBidCount == 0.
    function verifyNoActiveBids() external view returns (bool clean, uint firstActiveBidId) {
        for (uint i = 0; i < bids.length; i++) {
            if (bids[i].state == BidState.ACTIVE) {
                return (false, i);
            }
        }
        return (true, 0);
    }

    // Ops-only O(N) assertion: reverts on first ACTIVE bid found.
    // Use in testing / dry-runs as the hard-revert counterpart to
    // the O(1) _assertNoActiveBids().  Not used in production paths.
    function assertNoActiveBidsSlow() external view {
        for (uint i = 0; i < bids.length; i++) {
            require(bids[i].state != BidState.ACTIVE, "Active bid found");
        }
    }

    // Ops-only O(N) diagnostic: recompute totalVaultedBaseTokens from
    // bid-level state.  Use to detect drift after proxy upgrades or
    // storage migrations.  Symmetric to verifyNoActiveBids/assertNoActiveBidsSlow.
    function computeTotalVaultedBaseTokensSlow() external view returns (uint sum) {
        for (uint i = 0; i < bids.length; i++) {
            if (bids[i].state == BidState.FINALIZED && bids[i].distributionVaulted) {
                sum = sum + bids[i].vaultedImmediate;
            }
        }
    }

    // Ceil division helper.
    function _ceilDiv(uint a, uint b) internal pure returns (uint) {
        if (a == 0) return 0;
        return ((a - 1) / b) + 1;
    }
}
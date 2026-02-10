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

// Uniform clearing price auction with tiered windows, refunds, and TGE flow.
//
// Bidders escrow USDST with a max price; clearing price P* is the highest
// tick price where aggregate demand >= sale supply.
// On success, tokens are distributed immediately after finalization (before TGE).
// Tokens are non-transferable until TGE unpauses the transfer lock.
// TGE seeds LP, releases treasury/reserve funds, and unpauses transfers.
contract record TokenLaunchAuction is Ownable {
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

    event AuctionInitialized(address usdToken, address stratoToken, uint saleSupply);
    event AuctionStarted(uint startTime, uint endTime, uint closeBufferStart);
    event BidsPaused();
    event BidsUnpaused();
    event BidPlaced(uint bidId, address bidder, uint budgetUSDST, uint maxPriceUSDST, uint tier);
    event BidCanceled(uint bidId, address bidder);
    event BidFinalized(uint bidId, address bidder, uint tokensCapped, uint spentUSDST, uint refundUSDST);
    event AuctionCanceled(uint cancelTime);
    event Finalized(uint clearingPrice, uint raisedUSDST, bool success);
    event FinalizeRewardPaid(address caller, uint amount);
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
    event LpReserveReclaimed(uint amount);
    event AuctionConfigUpdated(address caller);

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
    uint public finalizeRewardUSDST;
    uint public maxDistributionAttempts;
    uint public bonusTokenReserve;
    uint public bonusTokenReserveRemaining;

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

    Bid[] public record bids;
    mapping(address => uint[]) public record userBidIds;
    mapping(address => bool) public record allowlisted;

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
        uint finalizeRewardUSDST_,
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
        finalizeRewardUSDST = finalizeRewardUSDST_;
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
        uint finalizeRewardUSDST_,
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
        finalizeRewardUSDST = finalizeRewardUSDST_;
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
        Bid memory bid;
        bid.bidder = msg.sender;
        bid.budgetUSDST = budgetUSDST;
        bid.maxPriceUSDST = maxPriceUSDST;
        bid.createdAt = uint(block.timestamp);
        bid.state = BidState.ACTIVE;
        bid.tier = tier;

        bids.push(bid);
        uint bidId = bids.length - 1;
        userBidIds[msg.sender].push(bidId);

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

        emit BidCanceled(bidId, msg.sender);
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
        }

        require(bid.state == BidState.CANCELED, "Not canceled");
        bid.canceledRefundWithdrawn = true;
        totalCanceledRefundsRemaining = totalCanceledRefundsRemaining - bid.budgetUSDST;
        require(usdToken.transfer(msg.sender, bid.budgetUSDST), "USDST transfer failed");

        emit RefundWithdrawn(bidId, msg.sender, bid.budgetUSDST, RefundReason.AUCTION_CANCELED);
    }

    // Finalize after end time; computes clearing price and allocations.
    // Permissionless — anyone may call to advance auction state.
    function finalize() external {
        require(auctionStarted, "Not started");
        require(!auctionCanceled, "Auction canceled");
        require(!finalized, "Finalized");
        require(block.timestamp >= endTime, "Auction ongoing");

        finalized = true;
        finalizeTime = uint(block.timestamp);

        uint activeCount = _countActiveBids();
        if (activeCount == 0) {
            clearingPrice = 0;
            success = false;
            raisedUncappedUSDST = 0;
            raisedUSDST = 0;
            unsoldTokens = saleSupply;
            _finalizeEmpty();
            emit Finalized(clearingPrice, raisedUSDST, success);
            return;
        }

        uint price = _computeClearingPrice();
        clearingPrice = price;

        _computeAllocations();
        nextDistributionIndex = 0;

        if (success && finalizeRewardUSDST > 0) {
            require(treasuryUSDST >= finalizeRewardUSDST, "Finalize reward too large");
            treasuryUSDST = treasuryUSDST - finalizeRewardUSDST;
            require(usdToken.transfer(msg.sender, finalizeRewardUSDST), "Reward transfer failed");
            emit FinalizeRewardPaid(msg.sender, finalizeRewardUSDST);
        }

        emit Finalized(clearingPrice, raisedUSDST, success);
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

            uint baseTokens = bid.tokensCapped;
            uint bonusTokens = bid.bonusTokens;
            uint totalSent = baseTokens + bonusTokens;
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
                bid.distributed = true;
                pendingDistributions = pendingDistributions - 1;
                emit DistributionProcessed(bidId, bid.bidder, totalSent);
                continue;
            }

            bid.distributionAttempts = bid.distributionAttempts + 1;
            if (bid.distributionAttempts >= maxDistributionAttempts) {
                bid.distributed = true;
                bid.distributionVaulted = true;
                bid.vaultedImmediate = baseTokens;
                bid.vaultedBonusTokens = bonusTokens;
                pendingDistributions = pendingDistributions - 1;
                emit DistributionVaulted(bidId, bid.bidder, totalSent);
            }
        }
    }

    // Distribute the next `maxCount` bids in order, starting from the cursor.
    // Same semantics as distributeBatch but sequential.
    function distributeNext(uint maxCount) external {
        require(finalized, "Not finalized");
        require(success, "Not successful");
        require(!auctionCanceled, "Auction canceled");
        require(!unwound, "Unwound");
        require(maxCount > 0, "Invalid count");

        uint i = nextDistributionIndex;
        uint processed = 0;
        while (i < bids.length && processed < maxCount) {
            Bid storage bid = bids[i];
            if (!bid.distributed) {
                if (bid.tokensCapped == 0) {
                    bid.distributed = true;
                } else {
                    uint baseTokens = bid.tokensCapped;
                    uint bonusTokens = bid.bonusTokens;
                    uint totalSent = baseTokens + bonusTokens;
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
                        bid.distributed = true;
                        pendingDistributions = pendingDistributions - 1;
                        emit DistributionProcessed(i, bid.bidder, totalSent);
                        processed = processed + 1;
                    } else {
                        bid.distributionAttempts = bid.distributionAttempts + 1;
                        if (bid.distributionAttempts >= maxDistributionAttempts) {
                            bid.distributed = true;
                            bid.distributionVaulted = true;
                            bid.vaultedImmediate = baseTokens;
                            bid.vaultedBonusTokens = bonusTokens;
                            pendingDistributions = pendingDistributions - 1;
                            emit DistributionVaulted(i, bid.bidder, totalSent);
                            processed = processed + 1;
                        }
                    }
                }
            }

            i = i + 1;
        }

        nextDistributionIndex = i;
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
        require(!tgeExecuted, "TGE executed");
        tgeTime = newTgeTime;
        emit TgeScheduled(newTgeTime);
    }

    // Execute TGE: seed LP, unlock transfer lock, and release funds.
    // Requires all distributions to be complete and TGE time reached.
    function executeTGE() external onlyOwner {
        require(finalized, "Not finalized");
        require(success, "Not successful");
        require(!tgeExecuted, "TGE executed");
        require(!unwound, "Unwound");
        require(tgeTime != 0, "TGE not set");
        require(block.timestamp >= tgeTime, "TGE time");
        require(pendingDistributions == 0, "Distribution incomplete");

        uint lpStratoRequired = 0;
        if (lpUSDST > 0) {
            lpStratoRequired = _ceilDiv(lpUSDST * tokenUnit, clearingPrice);
            require(lpTokenReserve >= lpStratoRequired, "LP STRATO shortfall");
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

        tgeExecuted = true;
        emit TgeExecuted(tgeTime, lpUSDST, lpStratoRequired, treasuryUSDST, reserveUSDST);
    }

    // Optional pre-TGE treasury withdrawal subject to cap.
    function withdrawTreasuryPreTge(uint amount) external onlyOwner {
        require(finalized, "Not finalized");
        require(success, "Not successful");
        require(!tgeExecuted, "TGE executed");
        require(!unwound, "Unwound");
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

    // Abort path when TGE is delayed beyond maxTgeDelay.
    // Burns all participant STRATO (distributed, vaulted, and escrowed),
    // then computes pro-rata USDST refund pool from remaining balance.
    // Finalized refunds remain independently withdrawable.
    function unwind() external onlyOwner {
        require(finalized, "Not finalized");
        require(success, "Not successful");
        require(!tgeExecuted, "TGE executed");
        require(!unwound, "Already unwound");
        require(inResolutionMode(), "Not in resolution");

        uint i;

        // Burn tokens already distributed to bidders.
        // Transfers are still locked (no TGE), so bidders hold
        // non-transferable tokens that must be reclaimed.
        for (i = 0; i < bids.length; i++) {
            Bid storage bid = bids[i];
            if (bid.state != BidState.FINALIZED) continue;
            if (!bid.distributed) continue;
            if (bid.distributionVaulted) continue;

            if (bid.tokensDistributed > 0) {
                stratoToken.burn(bid.bidder, bid.tokensDistributed);
                bid.tokensDistributed = 0;
            }
        }

        // Zero vaulted balances (tokens still held by this contract).
        for (i = 0; i < bids.length; i++) {
            Bid storage bid = bids[i];
            if (bid.state != BidState.FINALIZED) continue;
            if (!bid.distributionVaulted) continue;

            bid.vaultedImmediate = 0;
            bid.vaultedBonusTokens = 0;
        }

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
        unwindAvailableUSDST = available;
        unwindRaisedUSDST = raisedUSDST;
        require(unwindRaisedUSDST > 0, "No raised funds to unwind");

        emit Unwound(unwindAvailableUSDST, unwindRaisedUSDST);
    }

    // Withdraw pro-rata USDST after unwind, proportional to accepted spend.
    function withdrawUnwound(uint bidId) external {
        require(unwound, "Not unwound");
        require(bidId < bids.length, "Invalid bid");
        Bid storage bid = bids[bidId];
        require(bid.bidder == msg.sender, "Not bidder");
        require(bid.state == BidState.FINALIZED, "Not finalized");
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

    // Test-only reset of auction state (must be inactive).
    function resetForTesting() external onlyOwner {
        require(!auctionStarted || finalized || auctionCanceled, "Auction active");

        uint i;
        for (i = 0; i < bids.length; i++) {
            Bid storage bid = bids[i];
            userBidIds[bid.bidder].length = 0;
        }
        bids.length = 0;

        auctionStarted = false;
        auctionCanceled = false;
        bidsPaused = false;
        startTime = 0;
        endTime = 0;
        closeBufferStart = 0;
        cancelTime = 0;

        finalized = false;
        success = false;
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

        tgeTime = 0;
        tgeExecuted = false;

        unwound = false;
        unwindAvailableUSDST = 0;
        unwindRaisedUSDST = 0;
        claimReserveRemaining = 0;
        nextDistributionIndex = 0;
    }

    // --- Internal functions ---

    // Handle finalize when there are no active bids.
    function _finalizeEmpty() internal {
        uint i;
        for (i = 0; i < bids.length; i++) {
            Bid storage bid = bids[i];
            if (bid.state == BidState.ACTIVE) {
                bid.state = BidState.FINALIZED;
                bid.spentUSDST = 0;
                bid.refundUSDST = bid.budgetUSDST;
                totalRefundsRemaining = totalRefundsRemaining + bid.refundUSDST;
                emit BidFinalized(i, bid.bidder, 0, 0, bid.refundUSDST);
            }
        }
    }

    // Compute capped allocations, spend, and refunds at the clearing price.
    // Classifies bids as above-P*, at-P*, or below-P* and distributes
    // supply accordingly. Applies maxRaise haircut if proceeds exceed cap.
    // Determines auction success based on minRaiseUSDST.
    function _computeAllocations() internal {
        uint totalTokensAbove = 0;
        uint totalDemandAt = 0;
        uint i;

        for (i = 0; i < bids.length; i++) {
            Bid storage bid = bids[i];
            if (bid.state != BidState.ACTIVE) {
                continue;
            }

            if (bid.maxPriceUSDST > clearingPrice) {
                bid.tokensUncapped = _tokensFromBudget(bid.budgetUSDST, clearingPrice);
                totalTokensAbove = totalTokensAbove + bid.tokensUncapped;
            } else if (bid.maxPriceUSDST == clearingPrice) {
                bid.tokensUncapped = _tokensFromBudget(bid.budgetUSDST, clearingPrice);
                totalDemandAt = totalDemandAt + bid.tokensUncapped;
            } else {
                bid.tokensUncapped = 0;
            }
        }

        // If above-P* demand alone exceeds supply, pro-rate them
        // and zero out at-P* allocations to prevent oversell.
        if (totalTokensAbove > saleSupply) {
            uint scalePrecision = tokenUnit;
            uint scale = (saleSupply * scalePrecision) / totalTokensAbove;
            uint scaledTotalAbove = 0;
            for (i = 0; i < bids.length; i++) {
                Bid storage bidScale = bids[i];
                if (bidScale.state != BidState.ACTIVE) {
                    continue;
                }
                if (bidScale.maxPriceUSDST > clearingPrice) {
                    bidScale.tokensUncapped = (bidScale.tokensUncapped * scale) / scalePrecision;
                    scaledTotalAbove = scaledTotalAbove + bidScale.tokensUncapped;
                } else if (bidScale.maxPriceUSDST == clearingPrice) {
                    bidScale.tokensUncapped = 0;
                }
            }
            totalTokensAbove = scaledTotalAbove;
            totalDemandAt = 0;
        }

        // Remaining supply after above-P* fills goes to at-P* bids pro-rata.
        uint remainingSupply = 0;
        if (saleSupply > totalTokensAbove) {
            remainingSupply = saleSupply - totalTokensAbove;
        }

        uint totalDemandAtOriginal = totalDemandAt;
        for (i = 0; i < bids.length; i++) {
            Bid storage bidAt = bids[i];
            if (bidAt.state != BidState.ACTIVE) {
                continue;
            }
            if (bidAt.maxPriceUSDST == clearingPrice) {
                if (totalDemandAtOriginal > 0) {
                    bidAt.tokensUncapped = (remainingSupply * bidAt.tokensUncapped) / totalDemandAtOriginal;
                } else {
                    bidAt.tokensUncapped = 0;
                }
            }
        }

        // Compute uncapped proceeds (token-first: spend derived from tokens).
        raisedUncappedUSDST = 0;
        for (i = 0; i < bids.length; i++) {
            Bid storage bidSpent = bids[i];
            if (bidSpent.state != BidState.ACTIVE) {
                continue;
            }
            if (bidSpent.maxPriceUSDST < clearingPrice) {
                bidSpent.tokensUncapped = 0;
            }
            uint spentUncapped = _spentFromTokens(bidSpent.tokensUncapped, clearingPrice);
            raisedUncappedUSDST = raisedUncappedUSDST + spentUncapped;
        }

        // Apply maxRaise haircut if proceeds exceed cap.
        uint raisedTmp = raisedUncappedUSDST;
        uint totalAllocatedTmp = 0;
        if (maxRaiseUSDST > 0 && raisedUncappedUSDST > maxRaiseUSDST) {
            raisedTmp = 0;
            for (i = 0; i < bids.length; i++) {
                Bid storage bidCap = bids[i];
                if (bidCap.state != BidState.ACTIVE) {
                    continue;
                }
                if (bidCap.maxPriceUSDST < clearingPrice) {
                    bidCap.tokensCapped = 0;
                } else {
                    bidCap.tokensCapped = (bidCap.tokensUncapped * maxRaiseUSDST) / raisedUncappedUSDST;
                }
                bidCap.spentUSDST = _spentFromTokens(bidCap.tokensCapped, clearingPrice);
                bidCap.refundUSDST = bidCap.budgetUSDST - bidCap.spentUSDST;
                totalAllocatedTmp = totalAllocatedTmp + bidCap.tokensCapped;
                raisedTmp = raisedTmp + bidCap.spentUSDST;
            }
        } else {
            for (i = 0; i < bids.length; i++) {
                Bid storage bidNoCap = bids[i];
                if (bidNoCap.state != BidState.ACTIVE) {
                    continue;
                }
                bidNoCap.tokensCapped = bidNoCap.tokensUncapped;
                bidNoCap.spentUSDST = _spentFromTokens(bidNoCap.tokensCapped, clearingPrice);
                bidNoCap.refundUSDST = bidNoCap.budgetUSDST - bidNoCap.spentUSDST;
                totalAllocatedTmp = totalAllocatedTmp + bidNoCap.tokensCapped;
            }
        }

        // Auction succeeds iff cleared proceeds meet minimum raise.
        if (raisedTmp >= minRaiseUSDST) {
            success = true;
            raisedUSDST = raisedTmp;
            totalAllocated = totalAllocatedTmp;
            if (saleSupply > totalAllocated) {
                unsoldTokens = saleSupply - totalAllocated;
            }
            _recordFinalizedBids();
            _computeBonusAllocations();
            _computeBuckets();
        } else {
            success = false;
            raisedUSDST = 0;
            unsoldTokens = saleSupply;
            _recordFailureBids();
        }
    }

    // Record finalized bid results and count pending distributions.
    function _recordFinalizedBids() internal {
        uint i;
        for (i = 0; i < bids.length; i++) {
            Bid storage bid = bids[i];
            if (bid.state != BidState.ACTIVE) {
                continue;
            }

            bid.state = BidState.FINALIZED;
            totalRefundsRemaining = totalRefundsRemaining + bid.refundUSDST;

            if (bid.tokensCapped > 0) {
                pendingDistributions = pendingDistributions + 1;
            }

            emit BidFinalized(i, bid.bidder, bid.tokensCapped, bid.spentUSDST, bid.refundUSDST);
        }
    }

    // Distribute the full bonus token reserve pro-rata among winning bids
    // placed during the bonus window (tier 1).
    // bonus_i = floor(bonusTokenReserve * tokensCapped_i / totalEligibleTokens)
    // Rounding dust remains in bonusTokenReserveRemaining, burnable via
    // burnRemainingBonus() after all distributions complete.
    function _computeBonusAllocations() internal {
        if (bonusTokenReserve == 0) {
            bonusTokenReserveRemaining = 0;
            return;
        }

        uint totalDemand = 0;
        uint i;
        uint cutoff = startTime + tier1WindowSeconds;
        for (i = 0; i < bids.length; i++) {
            Bid storage bid = bids[i];
            if (bid.state != BidState.FINALIZED) {
                continue;
            }
            if (bid.tokensCapped == 0) {
                continue;
            }
            if (bid.createdAt >= cutoff) {
                continue;
            }
            uint demand = bid.tokensCapped;
            bid.bonusTokens = demand;
            totalDemand = totalDemand + demand;
        }

        if (totalDemand == 0) {
            bonusTokenReserveRemaining = bonusTokenReserve;
            return;
        }

        uint totalBonusAllocated = 0;
        for (i = 0; i < bids.length; i++) {
            Bid storage bidScaled = bids[i];
            if (bidScaled.bonusTokens == 0) {
                continue;
            }
            uint bonus = (bonusTokenReserve * bidScaled.bonusTokens) / totalDemand;
            bidScaled.bonusTokens = bonus;
            totalBonusAllocated = totalBonusAllocated + bonus;
        }

        // Full reserve available for distribution; decremented as
        // transfers happen in distributeBatch/distributeNext.
        bonusTokenReserveRemaining = bonusTokenReserve;
    }

    // Record bid states for failed auctions (full refund, no tokens).
    function _recordFailureBids() internal {
        uint i;
        for (i = 0; i < bids.length; i++) {
            Bid storage bid = bids[i];
            if (bid.state != BidState.ACTIVE) {
                continue;
            }

            bid.state = BidState.FINALIZED;
            bid.tokensCapped = 0;
            bid.spentUSDST = 0;
            bid.refundUSDST = bid.budgetUSDST;
            totalRefundsRemaining = totalRefundsRemaining + bid.refundUSDST;

            emit BidFinalized(i, bid.bidder, 0, 0, bid.refundUSDST);
        }
    }

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
        if (timestamp < tier1End) return 1;
        return 2;
    }

    // Minimum claim reserve needed to honor outstanding claims after a burn.
    function _requiredClaimReserve(uint additionalBurn) internal view returns (uint) {
        uint required = additionalBurn;
        uint i;
        for (i = 0; i < bids.length; i++) {
            Bid storage bid = bids[i];
            if (bid.state != BidState.FINALIZED) {
                continue;
            }
            if (bid.distributionVaulted) {
                required = required + (bid.vaultedImmediate);
                continue;
            }
            if (!bid.distributed) {
                required = required + bid.tokensCapped;
            }
        }
        return required;
    }

    // Convert budget to token amount at a given price.
    function _tokensFromBudget(uint budgetUSDST, uint price) internal view returns (uint) {
        return (budgetUSDST * tokenUnit) / price;
    }

    // Convert token amount to USDST spent at a given price.
    function _spentFromTokens(uint tokens, uint price) internal view returns (uint) {
        return (tokens * price) / tokenUnit;
    }

    // Find the highest tick price where aggregate demand >= sale supply.
    // Starts at ceil-to-tick(minPrice) since all bids are included below
    // that point. Returns minPrice if undersubscribed (no tick clears);
    // success/failure is determined by minRaiseUSDST in _computeAllocations.
    function _computeClearingPrice() internal view returns (uint) {
        uint minPrice = 0;
        uint maxPrice = 0;
        uint i;

        for (i = 0; i < bids.length; i++) {
            Bid storage bid = bids[i];
            if (bid.state != BidState.ACTIVE) continue;
            if (minPrice == 0 || bid.maxPriceUSDST < minPrice) {
                minPrice = bid.maxPriceUSDST;
            }
            if (bid.maxPriceUSDST > maxPrice) {
                maxPrice = bid.maxPriceUSDST;
            }
        }

        if (minPrice == 0) {
            return 0;
        }

        uint startAt = minPrice - (minPrice % priceTickUSDST);
        if (startAt < minPrice) startAt = startAt + priceTickUSDST;

        uint bestPrice = 0;
        uint price = startAt;
        while (price <= maxPrice) {
            uint demand = _demandAtPrice(price);
            if (demand >= saleSupply) {
                bestPrice = price;
            } else {
                break;
            }
            if (maxPrice - price < priceTickUSDST) {
                break;
            }
            price = price + priceTickUSDST;
        }

        return bestPrice > 0 ? bestPrice : minPrice;
    }

    // Total token demand at a given price from all eligible active bids.
    function _demandAtPrice(uint price) internal view returns (uint) {
        if (price == 0) return 0;
        uint demand = 0;
        uint i;
        for (i = 0; i < bids.length; i++) {
            Bid storage bid = bids[i];
            if (bid.state != BidState.ACTIVE) continue;
            if (bid.maxPriceUSDST >= price) {
                demand = demand + _tokensFromBudget(bid.budgetUSDST, price);
            }
        }
        return demand;
    }

    // Count active bids for finalize logic.
    function _countActiveBids() internal view returns (uint) {
        uint count = 0;
        uint i;
        for (i = 0; i < bids.length; i++) {
            if (bids[i].state == BidState.ACTIVE) {
                count = count + 1;
            }
        }
        return count;
    }

    // Ceil division helper.
    function _ceilDiv(uint a, uint b) internal pure returns (uint) {
        if (a == 0) return 0;
        return ((a - 1) / b) + 1;
    }
}
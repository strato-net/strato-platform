import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Auction/TokenLaunchAuction.sol";

// ---------------------------------------------------------------------------
// Mock tokens
// ---------------------------------------------------------------------------

contract record MockERC20 is ERC20, Ownable {
    uint8 _dec;
    constructor(string _name, string _symbol, uint8 dec_, address _owner)
        ERC20(_name, _symbol) Ownable(_owner)
    {
        _dec = dec_;
    }
    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
}

// ---------------------------------------------------------------------------
// Mock transfer lock controller
// ---------------------------------------------------------------------------

contract record MockTransferLock {
    bool public paused;
    constructor() { paused = true; }
    function unpause() external { paused = false; }
}

// ---------------------------------------------------------------------------
// Mock LP seeder (returns fake LP tokens)
// ---------------------------------------------------------------------------

contract record MockLpSeeder {
    address public pool;
    address public usdToken;
    address public stratoToken;
    address public auction;
    bool public initialized;
    MockERC20 public lpToken;

    constructor() {}

    function initialize(address pool_, address usdToken_, address stratoToken_, address auction_) external {
        pool = pool_;
        usdToken = usdToken_;
        stratoToken = stratoToken_;
        auction = auction_;
        lpToken = new MockERC20("LP Token", "LP", 18, address(this));
        initialized = true;
    }

    function seedAndLock(uint usdAmount, uint stratoAmount, uint price, address lpTokenRecipient) external returns (address, uint) {
        require(msg.sender == auction, "Not auction");
        uint lpMinted = usdAmount + stratoAmount;
        lpToken.mint(lpTokenRecipient, lpMinted);
        return (address(lpToken), lpMinted);
    }
}

// ---------------------------------------------------------------------------
// User helper — calls functions as msg.sender
// ---------------------------------------------------------------------------

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

// ---------------------------------------------------------------------------
// Test contract
// ---------------------------------------------------------------------------

contract Describe_TokenLaunchAuction is Authorizable {

    // Tokens
    MockERC20 usd;
    MockERC20 strato;

    // Infrastructure
    MockTransferLock transferLock;
    MockLpSeeder lpSeeder;
    LpTokenLockVault lpVault;

    // Auction
    TokenLaunchAuction auction;

    // Users
    User alice;
    User bob;
    User charlie;

    // Standard parameters
    uint SALE_SUPPLY;
    uint CLAIM_RESERVE;
    uint LP_RESERVE;
    uint BONUS_RESERVE;
    uint MIN_RAISE;
    uint MAX_RAISE;
    uint PRICE_TICK;
    uint WITHDRAW_DELAY;
    uint MAX_DIST_ATTEMPTS;
    uint AUCTION_DURATION;
    uint CLOSE_BUFFER;
    uint TIER1_WINDOW;
    uint TIER2_WINDOW;
    uint LP_BPS;
    uint TREASURY_BPS;
    uint RESERVE_BPS;
    uint PRE_TGE_BPS;
    uint MAX_TGE_DELAY;

    address treasuryWallet;
    address reserveWallet;

    function beforeAll() {
        bypassAuthorizations = true;

        alice = new User();
        bob = new User();
        charlie = new User();

        treasuryWallet = address(0x7777);
        reserveWallet = address(0x8888);

        SALE_SUPPLY = 2000000e18;
        CLAIM_RESERVE = 2000000e18;
        LP_RESERVE = 500000e18;
        BONUS_RESERVE = 200000e18;
        MIN_RAISE = 1000000e6;
        MAX_RAISE = 0;
        PRICE_TICK = 1e6;
        WITHDRAW_DELAY = 60;
        MAX_DIST_ATTEMPTS = 3;
        AUCTION_DURATION = 604800;
        CLOSE_BUFFER = 3600;
        TIER1_WINDOW = 86400;
        TIER2_WINDOW = 518400 - CLOSE_BUFFER;
        LP_BPS = 2000;
        TREASURY_BPS = 5000;
        RESERVE_BPS = 3000;
        PRE_TGE_BPS = 0;
        MAX_TGE_DELAY = 2592000;
    }

    function beforeEach() {
        usd = new MockERC20("USDST", "USDST", 6, address(this));
        strato = new MockERC20("STRATO", "STRATO", 18, address(this));
        transferLock = new MockTransferLock();
        lpSeeder = new MockLpSeeder();

        auction = new TokenLaunchAuction(address(this));
        lpVault = new LpTokenLockVault(address(auction));

        lpSeeder.initialize(address(0x1234), address(usd), address(strato), address(auction));

        auction.initialize(
            address(usd),
            address(strato),
            treasuryWallet,
            reserveWallet,
            address(lpSeeder),
            address(lpVault),
            address(transferLock),
            SALE_SUPPLY,
            CLAIM_RESERVE,
            LP_RESERVE,
            MIN_RAISE,
            MAX_RAISE,
            PRICE_TICK,
            WITHDRAW_DELAY,
            MAX_DIST_ATTEMPTS,
            BONUS_RESERVE,
            AUCTION_DURATION,
            CLOSE_BUFFER,
            TIER1_WINDOW,
            TIER2_WINDOW,
            false,
            0,
            LP_BPS,
            TREASURY_BPS,
            RESERVE_BPS,
            PRE_TGE_BPS,
            MAX_TGE_DELAY
        );

        // Escrow STRATO into auction
        uint totalEscrow = CLAIM_RESERVE + LP_RESERVE + BONUS_RESERVE;
        strato.mint(address(auction), totalEscrow);

        // Fund users with USDST
        usd.mint(address(alice), 100000000e6);
        usd.mint(address(bob), 100000000e6);
        usd.mint(address(charlie), 100000000e6);
    }

    // ========================================================================
    // Helper functions
    // ========================================================================

    function _startAuction() internal {
        fastForward(10);
        auction.startAuction();
    }

    function _placeBidAs(User user, uint budget, uint maxPrice) internal {
        user.do(address(usd), "approve(address,uint256)", address(auction), budget);
        user.do(address(auction), "placeBid(uint256,uint256)", budget, maxPrice);
    }

    function _finishAuction() internal {
        fastForward(AUCTION_DURATION + 1);
    }

    function _runSuccessfulAuction() internal {
        _startAuction();
        _placeBidAs(alice, 500000e6, 1e6);
        _placeBidAs(bob, 500000e6, 1e6);
        _placeBidAs(charlie, 200000e6, 1e6);
        _finishAuction();
        auction.finalize();
    }

    // ========================================================================
    // 1. Initialization Tests
    // ========================================================================

    function it_initializes_correctly() {
        require(auction.initialized(), "Should be initialized");
        require(auction.saleSupply() == SALE_SUPPLY, "Sale supply mismatch");
        require(auction.minRaiseUSDST() == MIN_RAISE, "Min raise mismatch");
        require(auction.priceTickUSDST() == PRICE_TICK, "Price tick mismatch");
        require(auction.tier1WindowSeconds() == TIER1_WINDOW, "Tier1 window mismatch");
    }

    function it_rejects_double_initialization() {
        bool reverted = false;
        try {
            auction.initialize(
                address(usd), address(strato), treasuryWallet, reserveWallet,
                address(lpSeeder), address(lpVault), address(transferLock),
                SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE, MIN_RAISE, MAX_RAISE,
                PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
                AUCTION_DURATION, CLOSE_BUFFER, TIER1_WINDOW, TIER2_WINDOW,
                false, 0, LP_BPS, TREASURY_BPS, RESERVE_BPS, PRE_TGE_BPS, MAX_TGE_DELAY
            );
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert on double init");
    }

    function it_rejects_invalid_bps_sum() {
        TokenLaunchAuction bad = new TokenLaunchAuction(address(this));
        bool reverted = false;
        try {
            bad.initialize(
                address(usd), address(strato), treasuryWallet, reserveWallet,
                address(lpSeeder), address(lpVault), address(transferLock),
                SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE, MIN_RAISE, MAX_RAISE,
                PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
                AUCTION_DURATION, CLOSE_BUFFER, TIER1_WINDOW, TIER2_WINDOW,
                false, 0,
                3000, 3000, 3000,
                PRE_TGE_BPS, MAX_TGE_DELAY
            );
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when bps != 10000");
    }

    function it_rejects_claim_reserve_less_than_sale_supply() {
        TokenLaunchAuction bad = new TokenLaunchAuction(address(this));
        bool reverted = false;
        try {
            bad.initialize(
                address(usd), address(strato), treasuryWallet, reserveWallet,
                address(lpSeeder), address(lpVault), address(transferLock),
                SALE_SUPPLY, SALE_SUPPLY - 1, LP_RESERVE, MIN_RAISE, MAX_RAISE,
                PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
                AUCTION_DURATION, CLOSE_BUFFER, TIER1_WINDOW, TIER2_WINDOW,
                false, 0, LP_BPS, TREASURY_BPS, RESERVE_BPS, PRE_TGE_BPS, MAX_TGE_DELAY
            );
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when claim reserve < sale supply");
    }

    function it_rejects_zero_price_tick() {
        TokenLaunchAuction bad = new TokenLaunchAuction(address(this));
        bool reverted = false;
        try {
            bad.initialize(
                address(usd), address(strato), treasuryWallet, reserveWallet,
                address(lpSeeder), address(lpVault), address(transferLock),
                SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE, MIN_RAISE, MAX_RAISE,
                0, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
                AUCTION_DURATION, CLOSE_BUFFER, TIER1_WINDOW, TIER2_WINDOW,
                false, 0, LP_BPS, TREASURY_BPS, RESERVE_BPS, PRE_TGE_BPS, MAX_TGE_DELAY
            );
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert on zero price tick");
    }

    function it_rejects_close_buffer_gte_duration() {
        TokenLaunchAuction bad = new TokenLaunchAuction(address(this));
        bool reverted = false;
        try {
            bad.initialize(
                address(usd), address(strato), treasuryWallet, reserveWallet,
                address(lpSeeder), address(lpVault), address(transferLock),
                SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE, MIN_RAISE, MAX_RAISE,
                PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
                3600, 3600, TIER1_WINDOW, TIER2_WINDOW,
                false, 0, LP_BPS, TREASURY_BPS, RESERVE_BPS, PRE_TGE_BPS, MAX_TGE_DELAY
            );
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when close buffer >= duration");
    }

    function it_rejects_tier_windows_exceeding_bidding_period() {
        TokenLaunchAuction bad = new TokenLaunchAuction(address(this));
        bool reverted = false;
        try {
            bad.initialize(
                address(usd), address(strato), treasuryWallet, reserveWallet,
                address(lpSeeder), address(lpVault), address(transferLock),
                SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE, MIN_RAISE, MAX_RAISE,
                PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
                AUCTION_DURATION, CLOSE_BUFFER,
                400000, 400000,
                false, 0, LP_BPS, TREASURY_BPS, RESERVE_BPS, PRE_TGE_BPS, MAX_TGE_DELAY
            );
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when tier windows exceed bidding period");
    }

    // ========================================================================
    // 2. updateConfig Tests
    // ========================================================================

    function it_allows_config_update_before_start() {
        auction.updateConfig(
            address(usd), address(strato), treasuryWallet, reserveWallet,
            address(lpSeeder), address(lpVault), address(transferLock),
            SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE,
            2000000e6,
            MAX_RAISE, PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
            AUCTION_DURATION, CLOSE_BUFFER, TIER1_WINDOW, TIER2_WINDOW,
            false, 0, LP_BPS, TREASURY_BPS, RESERVE_BPS, PRE_TGE_BPS, MAX_TGE_DELAY
        );
        require(auction.minRaiseUSDST() == 2000000e6, "Min raise not updated");
    }

    function it_rejects_config_update_after_start() {
        _startAuction();
        bool reverted = false;
        try {
            auction.updateConfig(
                address(usd), address(strato), treasuryWallet, reserveWallet,
                address(lpSeeder), address(lpVault), address(transferLock),
                SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE, MIN_RAISE, MAX_RAISE,
                PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
                AUCTION_DURATION, CLOSE_BUFFER, TIER1_WINDOW, TIER2_WINDOW,
                false, 0, LP_BPS, TREASURY_BPS, RESERVE_BPS, PRE_TGE_BPS, MAX_TGE_DELAY
            );
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert config update after start");
    }

    // ========================================================================
    // 3. startAuction Tests
    // ========================================================================

    function it_starts_auction_with_sufficient_escrow() {
        _startAuction();
        require(auction.auctionStarted(), "Auction should be started");
        require(auction.startTime() > 0, "Start time should be set");
        require(auction.endTime() == auction.startTime() + AUCTION_DURATION, "End time mismatch");
        require(auction.closeBufferStart() == auction.endTime() - CLOSE_BUFFER, "Close buffer start mismatch");
    }

    function it_rejects_start_without_escrow() {
        TokenLaunchAuction bad = new TokenLaunchAuction(address(this));
        bad.initialize(
            address(usd), address(strato), treasuryWallet, reserveWallet,
            address(lpSeeder), address(lpVault), address(transferLock),
            SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE, MIN_RAISE, MAX_RAISE,
            PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
            AUCTION_DURATION, CLOSE_BUFFER, TIER1_WINDOW, TIER2_WINDOW,
            false, 0, LP_BPS, TREASURY_BPS, RESERVE_BPS, PRE_TGE_BPS, MAX_TGE_DELAY
        );
        bool reverted = false;
        try {
            bad.startAuction();
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert without escrow");
    }

    function it_rejects_double_start() {
        _startAuction();
        bool reverted = false;
        try {
            auction.startAuction();
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert on double start");
    }

    // ========================================================================
    // 4. placeBid Tests — Happy Path
    // ========================================================================

    function it_places_bid_in_tier1() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);

        (address bidder, uint budget, uint maxPrice, uint createdAt, uint canceledAt,
         , uint tier, , , , , , , , , , , , , ) = auction.bids(0);
        require(bidder == address(alice), "Bidder mismatch");
        require(budget == 1000e6, "Budget mismatch");
        require(maxPrice == 5e6, "Price mismatch");
        require(tier == 1, "Should be tier 1");
    }

    function it_places_bid_in_tier2() {
        _startAuction();
        fastForward(TIER1_WINDOW + 1);
        _placeBidAs(alice, 1000e6, 5e6);

        (, , , , , , uint tier, , , , , , , , , , , , , ) = auction.bids(0);
        require(tier == 2, "Should be tier 2");
    }

    function it_allows_multiple_bids_per_user() {
        _startAuction();
        _placeBidAs(alice, 500e6, 3e6);
        _placeBidAs(alice, 800e6, 5e6);

        (address bidder1, uint budget1, , , , , , , , , , , , , , , , , , ) = auction.bids(0);
        (address bidder2, uint budget2, , , , , , , , , , , , , , , , , , ) = auction.bids(1);
        require(bidder1 == address(alice), "First bid bidder");
        require(bidder2 == address(alice), "Second bid bidder");
        require(budget1 == 500e6, "First bid budget");
        require(budget2 == 800e6, "Second bid budget");
    }

    function it_escrows_usd_on_bid() {
        _startAuction();
        uint balBefore = usd.balanceOf(address(auction));
        _placeBidAs(alice, 1000e6, 5e6);
        uint balAfter = usd.balanceOf(address(auction));
        require(balAfter - balBefore == 1000e6, "USDST not escrowed");
    }

    // ========================================================================
    // 5. placeBid Tests — Unhappy Path
    // ========================================================================

    function it_rejects_bid_before_start() {
        bool reverted = false;
        try {
            alice.do(address(usd), "approve(address,uint256)", address(auction), 1000e6);
            alice.do(address(auction), "placeBid(uint256,uint256)", 1000e6, 5e6);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert before start");
    }

    function it_rejects_bid_with_zero_budget() {
        _startAuction();
        bool reverted = false;
        try {
            alice.do(address(auction), "placeBid(uint256,uint256)", 0, 5e6);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert on zero budget");
    }

    function it_rejects_bid_with_zero_price() {
        _startAuction();
        bool reverted = false;
        try {
            alice.do(address(usd), "approve(address,uint256)", address(auction), 1000e6);
            alice.do(address(auction), "placeBid(uint256,uint256)", 1000e6, 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert on zero price");
    }

    function it_rejects_bid_with_invalid_price_tick() {
        _startAuction();
        bool reverted = false;
        try {
            alice.do(address(usd), "approve(address,uint256)", address(auction), 1000e6);
            alice.do(address(auction), "placeBid(uint256,uint256)", 1000e6, 1500000);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert on bad tick (1.5e6 not multiple of 1e6)");
    }

    function it_rejects_bid_during_close_buffer() {
        _startAuction();
        fastForward(AUCTION_DURATION - CLOSE_BUFFER + 1);
        bool reverted = false;
        try {
            alice.do(address(usd), "approve(address,uint256)", address(auction), 1000e6);
            alice.do(address(auction), "placeBid(uint256,uint256)", 1000e6, 5e6);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert during close buffer");
    }

    function it_rejects_bid_outside_tier_windows() {
        _startAuction();
        // After tier1 + tier2 but before close buffer
        fastForward(TIER1_WINDOW + TIER2_WINDOW + 1);
        bool reverted = false;
        try {
            alice.do(address(usd), "approve(address,uint256)", address(auction), 1000e6);
            alice.do(address(auction), "placeBid(uint256,uint256)", 1000e6, 5e6);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert outside tier windows");
    }

    function it_rejects_bid_when_paused() {
        _startAuction();
        auction.pauseBids();
        bool reverted = false;
        try {
            alice.do(address(usd), "approve(address,uint256)", address(auction), 1000e6);
            alice.do(address(auction), "placeBid(uint256,uint256)", 1000e6, 5e6);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when bids paused");
    }

    function it_accepts_bid_after_unpause() {
        _startAuction();
        auction.pauseBids();
        auction.unpauseBids();
        _placeBidAs(alice, 1000e6, 5e6);
        (address bidder, , , , , , , , , , , , , , , , , , , ) = auction.bids(0);
        require(bidder == address(alice), "Bid should be placed after unpause");
    }

    // ========================================================================
    // 6. Allowlist Tests
    // ========================================================================

    function it_enforces_allowlist_during_window() {
        TokenLaunchAuction alAuction = new TokenLaunchAuction(address(this));
        alAuction.initialize(
            address(usd), address(strato), treasuryWallet, reserveWallet,
            address(lpSeeder), address(lpVault), address(transferLock),
            SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE, MIN_RAISE, MAX_RAISE,
            PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
            AUCTION_DURATION, CLOSE_BUFFER, TIER1_WINDOW, TIER2_WINDOW,
            true, 43200,
            LP_BPS, TREASURY_BPS, RESERVE_BPS, PRE_TGE_BPS, MAX_TGE_DELAY
        );

        address[] memory accounts = new address[](1);
        accounts[0] = address(alice);
        alAuction.updateAllowlist(accounts, true);

        strato.mint(address(alAuction), CLAIM_RESERVE + LP_RESERVE + BONUS_RESERVE);
        alAuction.startAuction();

        // Alice (allowlisted) can bid
        alice.do(address(usd), "approve(address,uint256)", address(alAuction), 1000e6);
        alice.do(address(alAuction), "placeBid(uint256,uint256)", 1000e6, 5e6);

        // Bob (not allowlisted) cannot bid during allowlist window
        bool reverted = false;
        try {
            bob.do(address(usd), "approve(address,uint256)", address(alAuction), 1000e6);
            bob.do(address(alAuction), "placeBid(uint256,uint256)", 1000e6, 5e6);
        } catch {
            reverted = true;
        }
        require(reverted, "Non-allowlisted should be rejected during allowlist window");
    }

    function it_allows_anyone_after_allowlist_window() {
        TokenLaunchAuction alAuction = new TokenLaunchAuction(address(this));
        alAuction.initialize(
            address(usd), address(strato), treasuryWallet, reserveWallet,
            address(lpSeeder), address(lpVault), address(transferLock),
            SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE, MIN_RAISE, MAX_RAISE,
            PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
            AUCTION_DURATION, CLOSE_BUFFER, TIER1_WINDOW, TIER2_WINDOW,
            true, 43200,
            LP_BPS, TREASURY_BPS, RESERVE_BPS, PRE_TGE_BPS, MAX_TGE_DELAY
        );
        strato.mint(address(alAuction), CLAIM_RESERVE + LP_RESERVE + BONUS_RESERVE);
        alAuction.startAuction();

        // Fast forward past allowlist window (43200s) but still in tier 1
        fastForward(43201);
        bob.do(address(usd), "approve(address,uint256)", address(alAuction), 1000e6);
        bob.do(address(alAuction), "placeBid(uint256,uint256)", 1000e6, 5e6);
        // If we got here, bob's bid succeeded
    }

    // ========================================================================
    // 7. cancelBid Tests
    // ========================================================================

    function it_cancels_bid_before_close_buffer() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        alice.do(address(auction), "cancelBid(uint256)", 0);

        (, , , , , BidState state, , , , , , , , , , , , , , ) = auction.bids(0);
        require(state == BidState.CANCELED, "Bid should be canceled");
    }

    function it_rejects_cancel_by_non_bidder() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        bool reverted = false;
        try {
            bob.do(address(auction), "cancelBid(uint256)", 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Non-bidder should not cancel");
    }

    function it_rejects_cancel_during_close_buffer() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        fastForward(AUCTION_DURATION - CLOSE_BUFFER + 1);
        bool reverted = false;
        try {
            alice.do(address(auction), "cancelBid(uint256)", 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not cancel during close buffer");
    }

    function it_rejects_cancel_of_already_canceled() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        alice.do(address(auction), "cancelBid(uint256)", 0);
        bool reverted = false;
        try {
            alice.do(address(auction), "cancelBid(uint256)", 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not cancel already canceled bid");
    }

    // ========================================================================
    // 8. withdrawCanceled Tests
    // ========================================================================

    function it_withdraws_canceled_bid_after_delay() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        alice.do(address(auction), "cancelBid(uint256)", 0);
        fastForward(WITHDRAW_DELAY + 1);

        uint balBefore = usd.balanceOf(address(alice));
        alice.do(address(auction), "withdrawCanceled(uint256)", 0);
        uint balAfter = usd.balanceOf(address(alice));
        require(balAfter - balBefore == 1000e6, "Should receive canceled refund");
    }

    function it_rejects_withdraw_before_delay() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        alice.do(address(auction), "cancelBid(uint256)", 0);
        bool reverted = false;
        try {
            alice.do(address(auction), "withdrawCanceled(uint256)", 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert before delay");
    }

    function it_rejects_double_withdraw_canceled() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        alice.do(address(auction), "cancelBid(uint256)", 0);
        fastForward(WITHDRAW_DELAY + 1);
        alice.do(address(auction), "withdrawCanceled(uint256)", 0);
        bool reverted = false;
        try {
            alice.do(address(auction), "withdrawCanceled(uint256)", 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not double withdraw");
    }

    function it_rejects_withdraw_canceled_during_close_buffer() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        alice.do(address(auction), "cancelBid(uint256)", 0);
        // Jump to close buffer (after delay has passed)
        fastForward(AUCTION_DURATION - CLOSE_BUFFER + 1);
        bool reverted = false;
        try {
            alice.do(address(auction), "withdrawCanceled(uint256)", 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not withdraw during close buffer");
    }

    function it_allows_withdraw_canceled_after_auction_ends() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        alice.do(address(auction), "cancelBid(uint256)", 0);
        // Jump past end time
        fastForward(AUCTION_DURATION + 1);
        alice.do(address(auction), "withdrawCanceled(uint256)", 0);
    }

    // ========================================================================
    // 9. cancelAuction Tests
    // ========================================================================

    function it_cancels_auction_before_close_buffer() {
        _startAuction();
        auction.cancelAuction();
        require(auction.auctionCanceled(), "Auction should be canceled");
    }

    function it_rejects_cancel_auction_during_close_buffer() {
        _startAuction();
        fastForward(AUCTION_DURATION - CLOSE_BUFFER + 1);
        bool reverted = false;
        try {
            auction.cancelAuction();
        } catch {
            reverted = true;
        }
        require(reverted, "Should not cancel during close buffer");
    }

    function it_allows_withdrawal_after_auction_cancel() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        _placeBidAs(bob, 2000e6, 3e6);
        auction.cancelAuction();

        uint aliceBefore = usd.balanceOf(address(alice));
        alice.do(address(auction), "withdrawAfterCancel(uint256)", 0);
        uint aliceAfter = usd.balanceOf(address(alice));
        require(aliceAfter - aliceBefore == 1000e6, "Alice should get refund");

        uint bobBefore = usd.balanceOf(address(bob));
        bob.do(address(auction), "withdrawAfterCancel(uint256)", 1);
        uint bobAfter = usd.balanceOf(address(bob));
        require(bobAfter - bobBefore == 2000e6, "Bob should get refund");
    }

    function it_allows_withdrawal_of_previously_canceled_bid_after_auction_cancel() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        alice.do(address(auction), "cancelBid(uint256)", 0);
        auction.cancelAuction();
        // Already CANCELED bids should still be withdrawable via withdrawAfterCancel
        alice.do(address(auction), "withdrawAfterCancel(uint256)", 0);
    }

    function it_rejects_bid_after_auction_cancel() {
        _startAuction();
        auction.cancelAuction();
        bool reverted = false;
        try {
            alice.do(address(usd), "approve(address,uint256)", address(auction), 1000e6);
            alice.do(address(auction), "placeBid(uint256,uint256)", 1000e6, 5e6);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not bid after auction cancel");
    }

    // ========================================================================
    // 10. Finalization — Successful Auction (Happy Path)
    // ========================================================================

    function it_finalizes_successful_auction() {
        _startAuction();
        // Place bids that exceed minRaise at some price
        _placeBidAs(alice, 600000e6, 1e6);
        _placeBidAs(bob, 600000e6, 1e6);
        _finishAuction();
        auction.finalize();

        require(auction.finalized(), "Should be finalized");
        require(auction.success(), "Should be successful");
        require(auction.clearingPrice() == 1e6, "P* should be 1e6");
        require(auction.raisedUSDST() >= MIN_RAISE, "Raised should exceed min");
    }

    function it_finalizes_with_correct_allocations() {
        _startAuction();
        // Two bidders, each 600000e6 at 1 USDST/STRATO
        // Total demand = 1200000 tokens at P*=1, supply = 2000000
        // Under-subscribed: both get full allocation
        _placeBidAs(alice, 600000e6, 1e6);
        _placeBidAs(bob, 600000e6, 1e6);
        _finishAuction();
        auction.finalize();

        // Alice bid 0: 600000e6 budget at P*=1e6, tokens = 600000e6 * 1e18 / 1e6 = 600000e18
        (, , , , , , , , uint tokensCapped0, uint spent0, uint refund0, , , , , , , , , ) = auction.bids(0);
        require(tokensCapped0 == 600000e18, "Alice tokensCapped wrong");
        require(spent0 == 600000e6, "Alice spent wrong");
        require(refund0 == 0, "Alice refund wrong");
    }

    function it_computes_buckets_correctly() {
        _startAuction();
        _placeBidAs(alice, 600000e6, 1e6);
        _placeBidAs(bob, 600000e6, 1e6);
        _finishAuction();
        auction.finalize();

        uint raised = auction.raisedUSDST();
        uint expectedLp = (raised * LP_BPS) / 10000;
        uint expectedTreasury = (raised * TREASURY_BPS) / 10000;
        uint expectedReserve = (raised * RESERVE_BPS) / 10000;
        uint dust = raised - expectedLp - expectedTreasury - expectedReserve;

        require(auction.lpUSDST() == expectedLp, "LP bucket wrong");
        require(auction.treasuryUSDST() == expectedTreasury + dust, "Treasury bucket wrong (with dust)");
        require(auction.reserveUSDST() == expectedReserve, "Reserve bucket wrong");
    }

    // ========================================================================
    // 11. Finalization — Failed Auction
    // ========================================================================

    function it_finalizes_failed_auction_below_min_raise() {
        _startAuction();
        // Place a bid well below minRaise
        _placeBidAs(alice, 100e6, 1e6);
        _finishAuction();
        auction.finalize();

        require(auction.finalized(), "Should be finalized");
        require(!auction.success(), "Should have failed");
        // Alice should get full refund
        (, , , , , , , , uint tokensCapped, , uint refund, , , , , , , , , ) = auction.bids(0);
        require(tokensCapped == 0, "No tokens on failed auction");
        require(refund == 100e6, "Full refund on failure");
    }

    function it_allows_refund_withdrawal_on_failed_auction() {
        _startAuction();
        _placeBidAs(alice, 100e6, 1e6);
        _finishAuction();
        auction.finalize();

        uint balBefore = usd.balanceOf(address(alice));
        alice.do(address(auction), "withdrawRefund(uint256)", 0);
        uint balAfter = usd.balanceOf(address(alice));
        require(balAfter - balBefore == 100e6, "Should get full refund on failure");
    }

    function it_allows_recover_after_failure() {
        _startAuction();
        _placeBidAs(alice, 100e6, 1e6);
        _finishAuction();
        auction.finalize();

        uint stratoBal = strato.balanceOf(address(auction));
        require(stratoBal > 0, "Should have STRATO to recover");
        auction.recoverAfterFailure();
        uint treasuryBal = strato.balanceOf(treasuryWallet);
        require(treasuryBal == stratoBal, "Treasury should receive recovered STRATO");
    }

    function it_rejects_recover_on_successful_auction() {
        _runSuccessfulAuction();
        bool reverted = false;
        try {
            auction.recoverAfterFailure();
        } catch {
            reverted = true;
        }
        require(reverted, "Should not recover on success");
    }

    // ========================================================================
    // 12. Finalization — Zero Active Bids (all canceled)
    // ========================================================================

    function it_finalizes_when_all_bids_canceled() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        alice.do(address(auction), "cancelBid(uint256)", 0);
        _finishAuction();
        auction.finalize();

        require(auction.finalized(), "Should be finalized");
        require(!auction.success(), "Should fail with no active bids");
        require(auction.clearingPrice() == 0, "P* should be 0");
    }

    // ========================================================================
    // 13. Clearing Price Discovery
    // ========================================================================

    function it_finds_clearing_price_single_level() {
        _startAuction();
        // 2M supply at $1 each requires $2M budget
        _placeBidAs(alice, 1000000e6, 1e6);
        _placeBidAs(bob, 1000000e6, 1e6);
        _finishAuction();
        auction.finalize();

        require(auction.clearingPrice() == 1e6, "P* = 1 USDST");
        require(auction.demandClearsSupply(), "Demand should clear supply");
    }

    function it_finds_clearing_price_multiple_levels() {
        _startAuction();
        // Alice bids 3M at $3 => 1M tokens demand
        // Bob bids 2M at $2 => 1M tokens demand
        // Supply = 2M tokens
        // At $3: cumDemand = 1M < 2M
        // At $2: cumDemand = 1M + 1M = 2M >= 2M => P* = $2
        _placeBidAs(alice, 3000000e6, 3e6);
        _placeBidAs(bob, 2000000e6, 2e6);
        _finishAuction();
        auction.finalize();

        require(auction.clearingPrice() == 2e6, "P* = 2 USDST");
        require(auction.demandClearsSupply(), "Demand should clear supply");
    }

    function it_handles_undersubscription() {
        _startAuction();
        // Only 100000 tokens demanded at $1 (far below 2M supply)
        _placeBidAs(alice, 100000e6, 1e6);
        _finishAuction();
        auction.finalize();

        require(!auction.demandClearsSupply(), "Demand should not clear supply");
        require(auction.clearingPrice() == 1e6, "P* = lowest active price");
    }

    function it_handles_oversubscription_at_clearing_price() {
        _startAuction();
        // At $1, demand = 3M tokens but supply = 2M
        // Alice: $1.5M / $1 = 1.5M tokens at $1 (above P*)
        // Bob: $1M / $1 = 1M tokens at $1 (at P*)
        // Charlie: $1M / $1 = 1M tokens at $1 (at P*)
        // If P* = $1: above-P* demand = 1.5M tokens (from Alice at $1, but wait...
        // Let me use distinct prices:
        // Alice: 2M at $2 => 1M tokens above any $1 price
        // Bob: 1M at $1 => 1M tokens at P*
        // Charlie: 1M at $1 => 1M tokens at P*
        // At $2: cumDemand = 1M tokens (from Alice's 2M/$2) < 2M supply
        // At $1: cumDemand = 1M + 2M(1M/$1 + 1M/$1) = 3M >= 2M => P*=$1
        // Above P*: Alice gets 1M tokens (all at $1 price = 1M USDST spent)
        // Remaining: 2M - 1M = 1M tokens for at-P* group
        // Bob & Charlie each have 1M demand at P*, total = 2M demand at P*
        // Pro-rata: each gets 1M * (1M/2M) = 500000 tokens
        _placeBidAs(alice, 2000000e6, 2e6);
        fastForward(TIER1_WINDOW + 1);
        _placeBidAs(bob, 1000000e6, 1e6);
        _placeBidAs(charlie, 1000000e6, 1e6);
        _finishAuction();
        auction.finalize();

        require(auction.clearingPrice() == 1e6, "P* should be 1");
        // Alice (above P*): full allocation
        (, , , , , , , , uint aliceTokens, uint aliceSpent, uint aliceRefund, , , , , , , , , ) = auction.bids(0);
        // Alice: 2000000e6 / 1e6 * 1e18 = 2000000e18 tokens from budget at P*, but supply is only 2M
        // Actually Alice bid 2M at $2: baseTokens = 2000000e6 * 1e18 / 1e6 = 2000000e18
        // But allocationTotalTokensAbove at clearing price $1 = 2000000e18
        // That equals saleSupply, so remainingSupply = 0
        // At-P* bids get 0 (since above-P* fills entire supply)
        require(aliceTokens == 2000000e18, "Alice gets full supply");
        require(aliceSpent == 2000000e6, "Alice spends full budget at P*");
        require(aliceRefund == 0, "Alice no refund");

        // Bob & Charlie at P* get 0 (oversubscribed case where above-P* fills supply)
        (, , , , , , , , uint bobTokens, , uint bobRefund, , , , , , , , , ) = auction.bids(1);
        require(bobTokens == 0, "Bob gets 0 when supply filled by above-P*");
        require(bobRefund == 1000000e6, "Bob gets full refund");
    }

    // ========================================================================
    // 14. Max Raise Enforcement
    // ========================================================================

    function it_applies_max_raise_haircut() {
        // Create auction with max raise
        TokenLaunchAuction capAuction = new TokenLaunchAuction(address(this));
        capAuction.initialize(
            address(usd), address(strato), treasuryWallet, reserveWallet,
            address(lpSeeder), address(lpVault), address(transferLock),
            SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE, MIN_RAISE,
            1000000e6,
            PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
            AUCTION_DURATION, CLOSE_BUFFER, TIER1_WINDOW, TIER2_WINDOW,
            false, 0, LP_BPS, TREASURY_BPS, RESERVE_BPS, PRE_TGE_BPS, MAX_TGE_DELAY
        );
        strato.mint(address(capAuction), CLAIM_RESERVE + LP_RESERVE + BONUS_RESERVE);
        capAuction.startAuction();

        // Place bids that would raise 2M at P*=$1
        alice.do(address(usd), "approve(address,uint256)", address(capAuction), 1000000e6);
        alice.do(address(capAuction), "placeBid(uint256,uint256)", 1000000e6, 1e6);
        bob.do(address(usd), "approve(address,uint256)", address(capAuction), 1000000e6);
        bob.do(address(capAuction), "placeBid(uint256,uint256)", 1000000e6, 1e6);

        fastForward(AUCTION_DURATION + 1);
        capAuction.finalize();

        require(capAuction.success(), "Should succeed");
        // raisedUSDST should be capped at maxRaise
        require(capAuction.raisedUSDST() <= 1000000e6, "Raised should be <= maxRaise");

        // Each bidder should have a refund (haircut applied)
        (, , , , , , , , , , uint aliceRefund, , , , , , , , , ) = capAuction.bids(0);
        require(aliceRefund > 0, "Alice should have refund from haircut");
    }

    // ========================================================================
    // 15. Distribution Tests
    // ========================================================================

    function it_distributes_tokens_after_finalization() {
        _runSuccessfulAuction();

        uint aliceBefore = strato.balanceOf(address(alice));
        uint[] memory bidIds = new uint[](3);
        bidIds[0] = 0;
        bidIds[1] = 1;
        bidIds[2] = 2;
        auction.distributeBatch(bidIds);
        uint aliceAfter = strato.balanceOf(address(alice));

        (, , , , , , , , uint aliceTokens, , , uint aliceBonus, , , , , , , , ) = auction.bids(0);
        require(aliceAfter - aliceBefore == aliceTokens + aliceBonus, "Alice should receive tokens + bonus");
    }

    function it_distributes_via_distributeNext() {
        _runSuccessfulAuction();
        auction.distributeNext(10);
        require(auction.pendingDistributions() == 0, "All should be distributed");
    }

    function it_rejects_distribution_before_finalization() {
        _startAuction();
        _placeBidAs(alice, 1000000e6, 1e6);
        bool reverted = false;
        try {
            uint[] memory bidIds = new uint[](1);
            bidIds[0] = 0;
            auction.distributeBatch(bidIds);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not distribute before finalization");
    }

    function it_rejects_distribution_on_failed_auction() {
        _startAuction();
        _placeBidAs(alice, 100e6, 1e6);
        _finishAuction();
        auction.finalize();

        bool reverted = false;
        try {
            auction.distributeNext(10);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not distribute on failed auction");
    }

    // ========================================================================
    // 16. Refund Withdrawal Tests
    // ========================================================================

    function it_withdraws_refund_for_non_clearing_bid() {
        _startAuction();
        // Alice bids at $5, Bob at $1. If supply clears at $5, Bob's $1 bid doesn't clear.
        // Need enough demand above: 2M supply at $5 requires 10M budget
        _placeBidAs(alice, 10000000e6, 5e6);
        _placeBidAs(bob, 1000000e6, 1e6);
        _finishAuction();
        auction.finalize();

        // P* should be 5 (Alice alone clears supply)
        require(auction.clearingPrice() == 5e6, "P* should be 5");

        // Bob should get full refund (below P*)
        uint bobBefore = usd.balanceOf(address(bob));
        bob.do(address(auction), "withdrawRefund(uint256)", 1);
        uint bobAfter = usd.balanceOf(address(bob));
        require(bobAfter - bobBefore == 1000000e6, "Bob should get full refund");
    }

    function it_rejects_refund_by_non_bidder() {
        _runSuccessfulAuction();
        bool reverted = false;
        try {
            bob.do(address(auction), "withdrawRefund(uint256)", 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Non-bidder should not withdraw refund");
    }

    function it_rejects_double_refund_withdrawal() {
        _startAuction();
        _placeBidAs(alice, 100e6, 1e6);
        _finishAuction();
        auction.finalize();

        alice.do(address(auction), "withdrawRefund(uint256)", 0);
        bool reverted = false;
        try {
            alice.do(address(auction), "withdrawRefund(uint256)", 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not double withdraw refund");
    }

    // ========================================================================
    // 17. Bonus Token Tests (Tier 1 Advantage)
    // ========================================================================

    function it_assigns_bonus_tokens_to_tier1_only() {
        _startAuction();
        // Alice bids in tier 1
        _placeBidAs(alice, 1000000e6, 1e6);
        // Bob bids in tier 2
        fastForward(TIER1_WINDOW + 1);
        _placeBidAs(bob, 1000000e6, 1e6);
        _finishAuction();
        auction.finalize();

        (, , , , , , , , , , , uint aliceBonus, , , , , , , , ) = auction.bids(0);
        (, , , , , , , , , , , uint bobBonus, , , , , , , , ) = auction.bids(1);

        require(aliceBonus > 0, "Alice (tier 1) should get bonus");
        require(bobBonus == 0, "Bob (tier 2) should get no bonus");
    }

    function it_distributes_bonus_pro_rata_among_tier1() {
        _startAuction();
        // Alice bids 2M, Bob bids 1M, both tier 1 at $2
        _placeBidAs(alice, 2000000e6, 2e6);
        _placeBidAs(bob, 1000000e6, 2e6);
        _finishAuction();
        auction.finalize();

        (, , , , , , , , uint aliceTokens, , , uint aliceBonus, , , , , , , , ) = auction.bids(0);
        (, , , , , , , , uint bobTokens, , , uint bobBonus, , , , , , , , ) = auction.bids(1);

        // Bonus should be proportional to tokensCapped
        // Alice tokens should be ~2x Bob tokens
        if (aliceTokens > 0 && bobTokens > 0) {
            // aliceBonus / bobBonus ≈ aliceTokens / bobTokens
            require(aliceBonus > bobBonus, "Alice should get more bonus than Bob");
        }
    }

    // ========================================================================
    // 18. burnUnsold and burnRemainingBonus Tests
    // ========================================================================

    function it_burns_unsold_tokens() {
        _startAuction();
        // Undersubscribed: only 100k tokens demanded
        _placeBidAs(alice, 1000000e6, 1e6);
        _finishAuction();
        auction.finalize();

        if (auction.success()) {
            auction.distributeNext(10);
            uint unsold = auction.unsoldTokens();
            if (unsold > 0) {
                uint stratoBefore = strato.balanceOf(address(auction));
                auction.burnUnsold();
                uint stratoAfter = strato.balanceOf(address(auction));
                require(stratoBefore - stratoAfter == unsold, "Unsold tokens should be burned");
                require(auction.unsoldTokens() == 0, "unsoldTokens should be 0 after burn");
            }
        }
    }

    function it_burns_remaining_bonus() {
        _runSuccessfulAuction();
        auction.distributeNext(10);

        uint bonusRemaining = auction.bonusTokenReserveRemaining();
        if (bonusRemaining > 0) {
            auction.burnRemainingBonus();
            require(auction.bonusTokenReserveRemaining() == 0, "Bonus remaining should be 0");
        }
    }

    function it_rejects_burn_unsold_with_pending_distributions() {
        _runSuccessfulAuction();
        // Don't distribute
        bool reverted = false;
        try {
            auction.burnUnsold();
        } catch {
            reverted = true;
        }
        require(reverted, "Should not burn unsold with pending distributions");
    }

    // ========================================================================
    // 19. TGE Tests
    // ========================================================================

    function it_sets_tge_time() {
        _runSuccessfulAuction();
        uint tge = uint(block.timestamp) + 86400;
        auction.setTgeTime(tge);
        require(auction.tgeTime() == tge, "TGE time should be set");
    }

    function it_rejects_tge_before_finalization() {
        _startAuction();
        bool reverted = false;
        try {
            auction.setTgeTime(uint(block.timestamp) + 86400);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not set TGE before finalization");
    }

    function it_executes_tge() {
        _runSuccessfulAuction();
        auction.distributeNext(10);

        uint tgeTimestamp = uint(block.timestamp) + 86400;
        auction.setTgeTime(tgeTimestamp);
        fastForward(86401);

        auction.executeTGE();
        require(auction.tgeExecuted(), "TGE should be executed");
        require(!transferLock.paused(), "Transfer lock should be unpaused");
    }

    function it_rejects_tge_with_pending_distributions() {
        _runSuccessfulAuction();
        // Don't distribute
        auction.setTgeTime(uint(block.timestamp) + 1);
        fastForward(2);

        bool reverted = false;
        try {
            auction.executeTGE();
        } catch {
            reverted = true;
        }
        require(reverted, "Should not execute TGE with pending distributions");
    }

    function it_rejects_tge_before_tge_time() {
        _runSuccessfulAuction();
        auction.distributeNext(10);
        auction.setTgeTime(uint(block.timestamp) + 86400);

        bool reverted = false;
        try {
            auction.executeTGE();
        } catch {
            reverted = true;
        }
        require(reverted, "Should not execute TGE before tge time");
    }

    function it_rejects_double_tge() {
        _runSuccessfulAuction();
        auction.distributeNext(10);
        auction.setTgeTime(uint(block.timestamp) + 1);
        fastForward(2);
        auction.executeTGE();

        bool reverted = false;
        try {
            auction.executeTGE();
        } catch {
            reverted = true;
        }
        require(reverted, "Should not double execute TGE");
    }

    function it_routes_treasury_and_reserve_at_tge() {
        _runSuccessfulAuction();
        auction.distributeNext(10);
        auction.setTgeTime(uint(block.timestamp) + 1);
        fastForward(2);

        uint treasuryBefore = usd.balanceOf(treasuryWallet);
        uint reserveBefore = usd.balanceOf(reserveWallet);

        auction.executeTGE();

        uint treasuryAfter = usd.balanceOf(treasuryWallet);
        uint reserveAfter = usd.balanceOf(reserveWallet);

        require(treasuryAfter > treasuryBefore, "Treasury should receive USDST");
        require(reserveAfter > reserveBefore, "Reserve should receive USDST");
    }

    // ========================================================================
    // 20. Pre-TGE Treasury Withdrawal Tests
    // ========================================================================

    function it_allows_pre_tge_treasury_withdrawal() {
        TokenLaunchAuction preTgeAuction = new TokenLaunchAuction(address(this));
        preTgeAuction.initialize(
            address(usd), address(strato), treasuryWallet, reserveWallet,
            address(lpSeeder), address(lpVault), address(transferLock),
            SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE, MIN_RAISE, MAX_RAISE,
            PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
            AUCTION_DURATION, CLOSE_BUFFER, TIER1_WINDOW, TIER2_WINDOW,
            false, 0, LP_BPS, TREASURY_BPS, RESERVE_BPS,
            5000,
            MAX_TGE_DELAY
        );
        strato.mint(address(preTgeAuction), CLAIM_RESERVE + LP_RESERVE + BONUS_RESERVE);
        preTgeAuction.startAuction();

        alice.do(address(usd), "approve(address,uint256)", address(preTgeAuction), 600000e6);
        alice.do(address(preTgeAuction), "placeBid(uint256,uint256)", 600000e6, 1e6);
        bob.do(address(usd), "approve(address,uint256)", address(preTgeAuction), 600000e6);
        bob.do(address(preTgeAuction), "placeBid(uint256,uint256)", 600000e6, 1e6);

        fastForward(AUCTION_DURATION + 1);
        preTgeAuction.finalize();

        uint maxWithdraw = (preTgeAuction.treasuryUSDST() * 5000) / 10000;
        if (maxWithdraw > 0) {
            uint before = usd.balanceOf(treasuryWallet);
            preTgeAuction.withdrawTreasuryPreTge(maxWithdraw);
            uint after_ = usd.balanceOf(treasuryWallet);
            require(after_ - before == maxWithdraw, "Pre-TGE withdrawal amount wrong");
        }
    }

    function it_rejects_pre_tge_withdrawal_exceeding_cap() {
        TokenLaunchAuction preTgeAuction = new TokenLaunchAuction(address(this));
        preTgeAuction.initialize(
            address(usd), address(strato), treasuryWallet, reserveWallet,
            address(lpSeeder), address(lpVault), address(transferLock),
            SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE, MIN_RAISE, MAX_RAISE,
            PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
            AUCTION_DURATION, CLOSE_BUFFER, TIER1_WINDOW, TIER2_WINDOW,
            false, 0, LP_BPS, TREASURY_BPS, RESERVE_BPS,
            5000,
            MAX_TGE_DELAY
        );
        strato.mint(address(preTgeAuction), CLAIM_RESERVE + LP_RESERVE + BONUS_RESERVE);
        preTgeAuction.startAuction();

        alice.do(address(usd), "approve(address,uint256)", address(preTgeAuction), 600000e6);
        alice.do(address(preTgeAuction), "placeBid(uint256,uint256)", 600000e6, 1e6);
        bob.do(address(usd), "approve(address,uint256)", address(preTgeAuction), 600000e6);
        bob.do(address(preTgeAuction), "placeBid(uint256,uint256)", 600000e6, 1e6);

        fastForward(AUCTION_DURATION + 1);
        preTgeAuction.finalize();

        uint maxWithdraw = (preTgeAuction.treasuryUSDST() * 5000) / 10000;
        bool reverted = false;
        try {
            preTgeAuction.withdrawTreasuryPreTge(maxWithdraw + 1);
        } catch {
            reverted = true;
        }
        require(reverted, "Should reject over-cap pre-TGE withdrawal");
    }

    function it_rejects_pre_tge_withdrawal_when_disabled() {
        // Default auction has preTgeWithdrawBps = 0
        _runSuccessfulAuction();
        bool reverted = false;
        try {
            auction.withdrawTreasuryPreTge(1);
        } catch {
            reverted = true;
        }
        require(reverted, "Should reject when pre-TGE disabled");
    }

    // ========================================================================
    // 21. Resolution Mode & Unwind Tests
    // ========================================================================

    function it_enters_resolution_mode_after_tge_delay() {
        _runSuccessfulAuction();
        require(!auction.inResolutionMode(), "Should not be in resolution mode yet");
        fastForward(MAX_TGE_DELAY + 1);
        require(auction.inResolutionMode(), "Should be in resolution mode");
    }

    function it_unwinds_auction() {
        _runSuccessfulAuction();
        auction.distributeNext(10);
        fastForward(MAX_TGE_DELAY + 1);

        auction.unwind();
        require(auction.unwindPhase() == 1, "Unwind phase should be 1");

        auction.unwindBatch(10);
        auction.finalizeUnwind();
        require(auction.unwound(), "Should be unwound");
    }

    function it_rejects_unwind_before_resolution_mode() {
        _runSuccessfulAuction();
        bool reverted = false;
        try {
            auction.unwind();
        } catch {
            reverted = true;
        }
        require(reverted, "Should not unwind before resolution mode");
    }

    function it_allows_withdraw_unwound() {
        _runSuccessfulAuction();
        auction.distributeNext(10);
        fastForward(MAX_TGE_DELAY + 1);

        auction.unwind();
        auction.unwindBatch(10);
        auction.finalizeUnwind();

        // Alice should be able to withdraw pro-rata USDST
        (, , , , , , , , , uint aliceSpent, , , , , , , , , , ) = auction.bids(0);
        if (aliceSpent > 0 && auction.unwindAvailableUSDST() > 0) {
            uint claimable = (aliceSpent * auction.unwindAvailableUSDST()) / auction.unwindRaisedUSDST();
            if (claimable > 0) {
                uint before = usd.balanceOf(address(alice));
                alice.do(address(auction), "withdrawUnwound(uint256)", 0);
                uint after_ = usd.balanceOf(address(alice));
                require(after_ - before == claimable, "Unwind withdrawal amount wrong");
            }
        }
    }

    function it_allows_reclaim_lp_reserve_after_unwind() {
        _runSuccessfulAuction();
        auction.distributeNext(10);
        fastForward(MAX_TGE_DELAY + 1);
        auction.unwind();
        auction.unwindBatch(10);
        auction.finalizeUnwind();

        uint lpReserve = auction.lpTokenReserve();
        if (lpReserve > 0) {
            uint before = strato.balanceOf(treasuryWallet);
            auction.reclaimLpReserve();
            uint after_ = strato.balanceOf(treasuryWallet);
            require(after_ - before == lpReserve, "Should reclaim LP reserve");
        }
    }

    function it_preserves_refunds_during_unwind() {
        _startAuction();
        _placeBidAs(alice, 10000000e6, 5e6);
        _placeBidAs(bob, 1000000e6, 1e6);
        _finishAuction();
        auction.finalize();

        // Bob has full refund (bid below P*)
        (, , , , , , , , , , uint bobRefund, , , , , , , , , ) = auction.bids(1);
        require(bobRefund > 0, "Bob should have refund");

        auction.distributeNext(10);
        fastForward(MAX_TGE_DELAY + 1);
        auction.unwind();
        auction.unwindBatch(10);
        auction.finalizeUnwind();

        // Bob's refund should still be withdrawable
        uint before = usd.balanceOf(address(bob));
        bob.do(address(auction), "withdrawRefund(uint256)", 1);
        uint after_ = usd.balanceOf(address(bob));
        require(after_ - before == bobRefund, "Refund should be preserved during unwind");
    }

    // ========================================================================
    // 22. Finalization Permissionless
    // ========================================================================

    function it_allows_anyone_to_finalize() {
        _startAuction();
        _placeBidAs(alice, 600000e6, 1e6);
        _placeBidAs(bob, 600000e6, 1e6);
        _finishAuction();

        // Charlie (not owner) finalizes
        charlie.do(address(auction), "finalize()");
        require(auction.finalized(), "Non-owner should be able to finalize");
    }

    function it_rejects_finalize_before_end_time() {
        _startAuction();
        _placeBidAs(alice, 600000e6, 1e6);
        bool reverted = false;
        try {
            auction.finalize();
        } catch {
            reverted = true;
        }
        require(reverted, "Should not finalize before end time");
    }

    function it_rejects_finalize_when_canceled() {
        _startAuction();
        _placeBidAs(alice, 600000e6, 1e6);
        auction.cancelAuction();
        _finishAuction();

        bool reverted = false;
        try {
            auction.finalize();
        } catch {
            reverted = true;
        }
        require(reverted, "Should not finalize canceled auction");
    }

    // ========================================================================
    // 23. Batched Finalization Tests
    // ========================================================================

    function it_finalizes_in_batches() {
        _startAuction();
        _placeBidAs(alice, 600000e6, 1e6);
        _placeBidAs(bob, 600000e6, 1e6);
        _finishAuction();

        // Phase 1: finalize price
        auction.finalizePrice();
        require(auction.priceFinalized(), "Price should be finalized");
        require(!auction.finalized(), "Should not be fully finalized yet");

        // Phase 2: finalize allocations in batches
        uint maxIterations = 0;
        while (!auction.finalized() && maxIterations < 50) {
            auction.finalizeAllocationsBatch(1);
            maxIterations = maxIterations + 1;
        }
        require(auction.finalized(), "Should be finalized after batched processing");
    }

    // ========================================================================
    // 24. Token-First Accounting Precision Tests
    // ========================================================================

    function it_ensures_no_overspend_per_bid() {
        _startAuction();
        // Use a price that causes rounding: budget / price may not be exact
        _placeBidAs(alice, 1000001e6, 3e6);
        _placeBidAs(bob, 999999e6, 3e6);
        _finishAuction();
        auction.finalize();

        (, , , , , , , , , uint aliceSpent, uint aliceRefund, , , , , , , , , ) = auction.bids(0);
        require(aliceSpent + aliceRefund == 1000001e6, "Alice spend + refund should equal budget");

        (, , , , , , , , , uint bobSpent, uint bobRefund, , , , , , , , , ) = auction.bids(1);
        require(bobSpent + bobRefund == 999999e6, "Bob spend + refund should equal budget");
    }

    function it_ensures_total_allocated_does_not_exceed_supply() {
        _startAuction();
        _placeBidAs(alice, 5000000e6, 1e6);
        _placeBidAs(bob, 5000000e6, 1e6);
        _finishAuction();
        auction.finalize();

        require(auction.totalAllocated() <= SALE_SUPPLY, "totalAllocated must not exceed saleSupply");
    }

    // ========================================================================
    // 25. Close Buffer Enforcement Tests
    // ========================================================================

    function it_freezes_bid_book_during_close_buffer() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        fastForward(AUCTION_DURATION - CLOSE_BUFFER + 1);

        // No new bids
        bool revertedBid = false;
        try {
            bob.do(address(usd), "approve(address,uint256)", address(auction), 1000e6);
            bob.do(address(auction), "placeBid(uint256,uint256)", 1000e6, 5e6);
        } catch {
            revertedBid = true;
        }
        require(revertedBid, "No bids during close buffer");

        // No cancellations
        bool revertedCancel = false;
        try {
            alice.do(address(auction), "cancelBid(uint256)", 0);
        } catch {
            revertedCancel = true;
        }
        require(revertedCancel, "No cancels during close buffer");
    }

    function it_rejects_finalize_during_close_buffer() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        // Jump to close buffer (not past endTime)
        fastForward(AUCTION_DURATION - CLOSE_BUFFER + 1);

        bool reverted = false;
        try {
            auction.finalize();
        } catch {
            reverted = true;
        }
        require(reverted, "Should not finalize during close buffer");
    }

    // ========================================================================
    // 26. Pause/Unpause Tests
    // ========================================================================

    function it_rejects_pause_when_not_started() {
        bool reverted = false;
        try {
            auction.pauseBids();
        } catch {
            reverted = true;
        }
        require(reverted, "Should not pause before start");
    }

    function it_rejects_pause_during_close_buffer() {
        _startAuction();
        fastForward(AUCTION_DURATION - CLOSE_BUFFER + 1);
        bool reverted = false;
        try {
            auction.pauseBids();
        } catch {
            reverted = true;
        }
        require(reverted, "Should not pause during close buffer");
    }

    // ========================================================================
    // 27. escrowHealth + diagnostic views
    // ========================================================================

    function it_reports_escrow_health() {
        (uint balance, uint tracked) = auction.escrowHealth();
        require(balance >= tracked, "Balance should >= tracked reserves");
    }

    function it_reports_finalize_progress() {
        _startAuction();
        _placeBidAs(alice, 600000e6, 1e6);
        _finishAuction();
        auction.finalizePrice();

        (uint stage, uint cursor, uint totalBids, bool done) = auction.finalizeProgress();
        require(totalBids == 1, "Should have 1 bid");
        require(!done, "Should not be done yet");
    }

    // ========================================================================
    // 28. resetForTesting Tests
    // ========================================================================

    function it_resets_auction_state_for_testing() {
        _runSuccessfulAuction();
        auction.resetForTesting();

        require(!auction.auctionStarted(), "Should not be started after reset");
        require(!auction.finalized(), "Should not be finalized after reset");
        require(auction.clearingPrice() == 0, "P* should be 0 after reset");
        require(auction.startTime() == 0, "Start time should be 0 after reset");
    }

    // ========================================================================
    // 29. Edge Case: Exact Supply Match
    // ========================================================================

    function it_handles_exact_supply_match() {
        _startAuction();
        // Demand exactly equals supply: 2M tokens at $1 each = $2M budget
        _placeBidAs(alice, 2000000e6, 1e6);
        _finishAuction();
        auction.finalize();

        require(auction.success(), "Should succeed with exact match");
        require(auction.unsoldTokens() == 0, "No unsold tokens");
        (, , , , , , , , uint tokens, , uint refund, , , , , , , , , ) = auction.bids(0);
        require(tokens == 2000000e18, "Should get all tokens");
        require(refund == 0, "No refund with exact match");
    }

    // ========================================================================
    // 30. Edge Case: Single Bid Auction
    // ========================================================================

    function it_handles_single_bid_success() {
        _startAuction();
        _placeBidAs(alice, 2000000e6, 1e6);
        _finishAuction();
        auction.finalize();

        require(auction.finalized(), "Should finalize");
        require(auction.success(), "Single bid should succeed if >= minRaise");
    }

    // ========================================================================
    // 31. Edge Case: Many Bids at Different Prices
    // ========================================================================

    function it_handles_three_price_levels() {
        _startAuction();
        // $3: 1.5M tokens
        _placeBidAs(alice, 4500000e6, 3e6);
        // $2: 1M tokens
        _placeBidAs(bob, 2000000e6, 2e6);
        // $1: 1M tokens
        fastForward(TIER1_WINDOW + 1);
        _placeBidAs(charlie, 1000000e6, 1e6);
        _finishAuction();
        auction.finalize();

        // At $3: cumDemand = 1.5M < 2M
        // At $2: cumDemand = 1.5M + 1M = 2.5M >= 2M => P* = $2
        require(auction.clearingPrice() == 2e6, "P* should be $2");
        require(auction.demandClearsSupply(), "Demand should clear");

        // Charlie ($1 bid) should get full refund
        (, , , , , , , , uint charlieTokens, , uint charlieRefund, , , , , , , , , ) = auction.bids(2);
        require(charlieTokens == 0, "Charlie below P* gets 0 tokens");
        require(charlieRefund == 1000000e6, "Charlie gets full refund");
    }

    // ========================================================================
    // 32. Edge Case: Large Price Tick
    // ========================================================================

    function it_enforces_price_tick_at_various_values() {
        _startAuction();
        // PRICE_TICK is 1e6, so any multiple of 1e6 is valid
        _placeBidAs(alice, 1000e6, 7e6);
        _placeBidAs(bob, 1000e6, 100e6);

        // Invalid: 1500000 (1.5e6 is not a multiple of 1e6)
        bool reverted = false;
        try {
            charlie.do(address(usd), "approve(address,uint256)", address(auction), 1000e6);
            charlie.do(address(auction), "placeBid(uint256,uint256)", 1000e6, 1500000);
        } catch {
            reverted = true;
        }
        require(reverted, "Non-tick-aligned price should revert");
    }

    // ========================================================================
    // 33. Edge Case: Withdrawal After Cancel Preserves Active Bid Accounting
    // ========================================================================

    function it_decrements_active_bid_count_on_cancel() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        _placeBidAs(bob, 2000e6, 3e6);
        require(auction.activeBidCount() == 2, "Should have 2 active bids");

        alice.do(address(auction), "cancelBid(uint256)", 0);
        require(auction.activeBidCount() == 1, "Should have 1 active bid after cancel");
    }

    // ========================================================================
    // 34. Edge Case: withdrawAfterCancel Converts Active to Canceled
    // ========================================================================

    function it_converts_active_to_canceled_on_auction_cancel_withdraw() {
        _startAuction();
        _placeBidAs(alice, 1000e6, 5e6);
        auction.cancelAuction();

        // Alice's bid is still ACTIVE state
        alice.do(address(auction), "withdrawAfterCancel(uint256)", 0);
        // After withdraw, should be CANCELED
        (, , , , , BidState state, , , , , , , , , , , , , , ) = auction.bids(0);
        require(state == BidState.CANCELED, "Should be canceled after withdrawAfterCancel");
    }

    // ========================================================================
    // 35. Edge Case: nextUndistributedFrom View
    // ========================================================================

    function it_finds_next_undistributed_bid() {
        _runSuccessfulAuction();

        (uint bidId, bool found) = auction.nextUndistributedFrom(0, 10);
        require(found, "Should find undistributed bid");

        // Distribute all
        auction.distributeNext(10);
        (uint bidId2, bool found2) = auction.nextUndistributedFrom(0, 10);
        require(!found2, "Should not find undistributed bid after distribution");
    }

    // ========================================================================
    // 36. Accounting Invariant: spend + refund = budget
    // ========================================================================

    function it_maintains_spend_plus_refund_equals_budget() {
        _startAuction();
        _placeBidAs(alice, 777777e6, 3e6);
        _placeBidAs(bob, 333333e6, 2e6);
        _placeBidAs(charlie, 123456e6, 1e6);
        _finishAuction();
        auction.finalize();

        uint i;
        for (i = 0; i < 3; i++) {
            (, , , , , BidState state, , , , uint spent, uint refund, , , , , , , , , ) = auction.bids(i);
            (, uint budget, , , , , , , , , , , , , , , , , , ) = auction.bids(i);
            if (state == BidState.FINALIZED) {
                require(spent + refund == budget, "spend + refund must equal budget for bid " + string(i));
            }
        }
    }

    // ========================================================================
    // 37. Vaulted Distribution (withdrawVaultedImmediate)
    // ========================================================================

    function it_rejects_vaulted_withdraw_when_not_vaulted() {
        _runSuccessfulAuction();
        auction.distributeNext(10);

        bool reverted = false;
        try {
            alice.do(address(auction), "withdrawVaultedImmediate(uint256)", 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not withdraw vaulted when not vaulted");
    }

    // ========================================================================
    // 38. Edge Case: verifyNoActiveBids diagnostic
    // ========================================================================

    function it_verifies_no_active_bids_after_finalization() {
        _runSuccessfulAuction();
        (bool clean, ) = auction.verifyNoActiveBids();
        require(clean, "No active bids should remain after finalization");
    }

    // ========================================================================
    // 39. Immutability: cannot change P* after finalization
    // ========================================================================

    function it_rejects_finalize_after_finalized() {
        _runSuccessfulAuction();
        bool reverted = false;
        try {
            auction.finalize();
        } catch {
            reverted = true;
        }
        require(reverted, "Should not re-finalize");
    }

    // ========================================================================
    // 40. Edge Case: Undersubscribed with Multiple Prices
    // ========================================================================

    function it_sets_p_star_to_lowest_active_when_undersubscribed() {
        _startAuction();
        // Very small bids: total demand far below 2M supply
        _placeBidAs(alice, 100e6, 5e6);
        _placeBidAs(bob, 100e6, 3e6);
        _finishAuction();
        auction.finalize();

        require(!auction.demandClearsSupply(), "Should be undersubscribed");
        // P* = lowest active level = 3e6
        require(auction.clearingPrice() == 3e6, "P* should be lowest active price");
    }

    // ========================================================================
    // 41. Edge Case: Canceled Bid Does Not Affect Clearing Price
    // ========================================================================

    function it_excludes_canceled_bids_from_price_discovery() {
        _startAuction();
        // Alice at $5, Bob at $3, Charlie at $1
        _placeBidAs(alice, 10000000e6, 5e6);
        _placeBidAs(bob, 1000000e6, 3e6);
        _placeBidAs(charlie, 1000000e6, 1e6);

        // Cancel Alice — without her, supply doesn't clear at $5
        alice.do(address(auction), "cancelBid(uint256)", 0);
        _finishAuction();
        auction.finalize();

        // With just Bob ($3) and Charlie ($1):
        // At $3: demand = 333333 tokens (1M/3)
        // At $1: cumDemand = 333333 + 1000000 = 1333333 tokens < 2M supply
        // Undersubscribed: P* = lowest = $1
        require(auction.clearingPrice() == 1e6, "P* should ignore canceled Alice's $5 bid");
    }

    // ========================================================================
    // 42. retryDistributeBid Tests
    // ========================================================================

    function it_rejects_retry_distribute_for_already_distributed() {
        _runSuccessfulAuction();
        auction.distributeNext(10);

        bool reverted = false;
        try {
            auction.retryDistributeBid(0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should not retry already distributed bid");
    }

    // ========================================================================
    // 43. Edge Case: Finalize with All Bids Below Any Viable Price
    // ========================================================================

    function it_handles_tiny_bids_below_min_raise() {
        _startAuction();
        _placeBidAs(alice, 1e6, 1e6);
        _finishAuction();
        auction.finalize();

        require(auction.finalized(), "Should finalize");
        require(!auction.success(), "Should fail (1 USDST < minRaise)");
    }

    // ========================================================================
    // 44. Invariant: unsoldTokens + totalAllocated = saleSupply (on success)
    // ========================================================================

    function it_maintains_unsold_plus_allocated_equals_supply() {
        _startAuction();
        _placeBidAs(alice, 600000e6, 1e6);
        _placeBidAs(bob, 600000e6, 1e6);
        _finishAuction();
        auction.finalize();

        if (auction.success()) {
            require(
                auction.unsoldTokens() + auction.totalAllocated() == SALE_SUPPLY,
                "unsold + allocated must equal supply"
            );
        }
    }

    // ========================================================================
    // 45. Permissionless Distribution
    // ========================================================================

    function it_allows_third_party_to_distribute() {
        _runSuccessfulAuction();
        // Charlie (not a bidder in this case, or 3rd bid) distributes for all
        charlie.do(address(auction), "distributeNext(uint256)", 10);
        require(auction.pendingDistributions() == 0, "Third party distribution should work");
    }

    // ========================================================================
    // 46. Multiple Bids Same User, Different Prices
    // ========================================================================

    function it_handles_multiple_bids_from_same_user() {
        _startAuction();
        _placeBidAs(alice, 500000e6, 3e6);
        _placeBidAs(alice, 1000000e6, 1e6);
        _placeBidAs(bob, 500000e6, 2e6);
        _finishAuction();
        auction.finalize();

        require(auction.finalized(), "Should finalize with multiple bids per user");
    }

    // ========================================================================
    // 47. Edge Case: TGE with Zero LP Bucket
    // ========================================================================

    function it_handles_tge_with_zero_lp_bucket() {
        // Create auction with lpBps = 0
        TokenLaunchAuction noLpAuction = new TokenLaunchAuction(address(this));
        noLpAuction.initialize(
            address(usd), address(strato), treasuryWallet, reserveWallet,
            address(lpSeeder), address(lpVault), address(transferLock),
            SALE_SUPPLY, CLAIM_RESERVE, LP_RESERVE, MIN_RAISE, MAX_RAISE,
            PRICE_TICK, WITHDRAW_DELAY, MAX_DIST_ATTEMPTS, BONUS_RESERVE,
            AUCTION_DURATION, CLOSE_BUFFER, TIER1_WINDOW, TIER2_WINDOW,
            false, 0,
            0, 7000, 3000,
            PRE_TGE_BPS, MAX_TGE_DELAY
        );
        strato.mint(address(noLpAuction), CLAIM_RESERVE + LP_RESERVE + BONUS_RESERVE);
        noLpAuction.startAuction();

        alice.do(address(usd), "approve(address,uint256)", address(noLpAuction), 600000e6);
        alice.do(address(noLpAuction), "placeBid(uint256,uint256)", 600000e6, 1e6);
        bob.do(address(usd), "approve(address,uint256)", address(noLpAuction), 600000e6);
        bob.do(address(noLpAuction), "placeBid(uint256,uint256)", 600000e6, 1e6);
        fastForward(AUCTION_DURATION + 1);
        noLpAuction.finalize();
        noLpAuction.distributeNext(10);

        noLpAuction.setTgeTime(uint(block.timestamp) + 1);
        fastForward(2);
        noLpAuction.executeTGE();
        require(noLpAuction.tgeExecuted(), "TGE with zero LP should succeed");
    }

    // ========================================================================
    // 48. Edge Case: Bid at Minimum Valid Price
    // ========================================================================

    function it_accepts_bid_at_minimum_price_tick() {
        _startAuction();
        _placeBidAs(alice, 1000e6, PRICE_TICK);
        (, , uint maxPrice, , , , , , , , , , , , , , , , , ) = auction.bids(0);
        require(maxPrice == PRICE_TICK, "Should accept bid at minimum price tick");
    }

    // ========================================================================
    // 49. Edge Case: Canceled Bid Cannot Be Finalized
    // ========================================================================

    function it_does_not_finalize_canceled_bids() {
        _startAuction();
        _placeBidAs(alice, 600000e6, 1e6);
        _placeBidAs(bob, 600000e6, 1e6);
        _placeBidAs(charlie, 100e6, 1e6);
        charlie.do(address(auction), "cancelBid(uint256)", 2);
        _finishAuction();
        auction.finalize();

        (, , , , , BidState state, , , , , , , , , , , , , , ) = auction.bids(2);
        require(state == BidState.CANCELED, "Canceled bid should stay canceled");
    }

    // ========================================================================
    // 50. Full Lifecycle Test
    // ========================================================================

    function it_completes_full_auction_lifecycle() {
        // 1. Start auction
        _startAuction();
        require(auction.auctionStarted(), "Step 1: started");

        // 2. Place bids (tier 1 + tier 2)
        _placeBidAs(alice, 1000000e6, 2e6);
        fastForward(TIER1_WINDOW + 1);
        _placeBidAs(bob, 1000000e6, 1e6);

        // 3. Wait for auction to end
        _finishAuction();

        // 4. Finalize
        auction.finalize();
        require(auction.finalized(), "Step 4: finalized");
        require(auction.success(), "Step 4: success");

        // 5. Distribute
        auction.distributeNext(10);
        require(auction.pendingDistributions() == 0, "Step 5: all distributed");

        // 6. Burns
        if (auction.unsoldTokens() > 0) {
            auction.burnUnsold();
        }
        if (auction.bonusTokenReserveRemaining() > 0) {
            auction.burnRemainingBonus();
        }

        // 7. TGE
        uint tgeTs = uint(block.timestamp) + 86400;
        auction.setTgeTime(tgeTs);
        fastForward(86401);
        auction.executeTGE();
        require(auction.tgeExecuted(), "Step 7: TGE executed");

        // 8. Verify Alice got bonus (tier 1)
        (, , , , , , , , , , , uint aliceBonus, , , , , , , , ) = auction.bids(0);
        require(aliceBonus > 0, "Step 8: Alice tier-1 bonus");

        // 9. Verify Bob got no bonus (tier 2)
        (, , , , , , , , , , , uint bobBonus, , , , , , , , ) = auction.bids(1);
        require(bobBonus == 0, "Step 9: Bob no bonus");

        // 10. Verify treasury and reserve received funds
        require(usd.balanceOf(treasuryWallet) > 0, "Step 10: treasury funded");
        require(usd.balanceOf(reserveWallet) > 0, "Step 10: reserve funded");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {LiquidityLauncher} from "../src/LiquidityLauncher.sol";
import {Distribution} from "../src/types/Distribution.sol";
import {IDistributionContract} from "../src/interfaces/IDistributionContract.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MockERC20} from "./mocks/MockERC20.sol";
import {MockTokenFactory} from "./mocks/MockTokenFactory.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";
import {MockCCAFactory, MockContinuousClearingAuction} from "./mocks/MockContinuousClearingAuction.sol";

/// @notice Stand-in for a distinct on-chain actor. SolidVM's `call` takes a
/// function name + variadic args, so dispatching via a User instance makes
/// msg.sender inside the callee be the User's address — enough to simulate
/// separate bidders competing in the same auction.
contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

/// @notice End-to-end simulation of a token auction launched via
/// LiquidityLauncher and cleared by the mock continuous-clearing-auction.
/// Covers the full lifecycle: token creation, strategy deployment, bidding
/// from multiple users, time advancement, settlement, and per-user claims
/// with the expected uniform-clearing-price economics.
contract Describe_TokenAuction {
    LiquidityLauncher launcher;
    MockTokenFactory factory;
    MockPermit2 permit2;
    MockCCAFactory ccaFactory;
    MockERC20 quote;

    User alice;
    User bob;
    User carol;
    User dave;

    // Auction tuning.
    uint256 constant SUPPLY = 1000;       // 1000 launch tokens for sale
    uint256 constant START_DELAY = 10;     // auction opens at t0 + 10
    uint256 constant AUCTION_LEN = 100;    // auction runs for 100 seconds
    uint256 constant QUOTE_SEED = 1000000; // quote tokens minted per bidder

    address launchToken;
    MockContinuousClearingAuction auction;

    function beforeAll() {
        // Nothing persistent between tests — each test rebuilds the world.
    }

    function beforeEach() {
        permit2 = new MockPermit2();
        factory = new MockTokenFactory();
        ccaFactory = new MockCCAFactory();
        launcher = new LiquidityLauncher(permit2);

        quote = new MockERC20("QuoteUSD", "qUSD", 18);

        alice = new User();
        bob = new User();
        carol = new User();
        dave = new User();

        quote.mint(address(alice), QUOTE_SEED);
        quote.mint(address(bob), QUOTE_SEED);
        quote.mint(address(carol), QUOTE_SEED);
        quote.mint(address(dave), QUOTE_SEED);

        _launchAuction();
    }

    /// @dev Creates the launch token minted to the test contract, approves
    /// permit2, and asks the CCA factory to set up an auction. Tokens flow
    /// test-contract → (permit2 pull) → auction. We avoid the safeTransfer
    /// path because SolidVM's Yul runtime doesn't yet implement the
    /// inline-assembly `call`/`gas` builtins SafeERC20 uses.
    function _launchAuction() internal {
        launchToken = launcher.createToken(
            address(factory),
            "LaunchCoin",
            "LC",
            18,
            uint128(SUPPLY),
            address(this),
            new bytes(0)
        );

        IERC20(launchToken).approve(address(permit2), SUPPLY);
        permit2.approve(launchToken, address(launcher), uint160(SUPPLY), uint48(0));

        uint256 startTime = block.timestamp + START_DELAY;
        uint256 endTime = startTime + AUCTION_LEN;
        ccaFactory.prepareAuction(address(quote), startTime, endTime);

        Distribution memory d = Distribution({
            strategy: address(ccaFactory),
            amount: uint128(SUPPLY),
            configData: new bytes(0)
        });
        IDistributionContract dc = launcher.distributeToken(launchToken, d, true, bytes32(uint256(42)));
        auction = MockContinuousClearingAuction(address(dc));
    }

    function _bid(User who, uint256 quantity, uint256 price) internal {
        uint256 cost = quantity * price;
        who.do(address(quote), "approve", address(auction), cost);
        who.do(address(auction), "commitBid", quantity, price);
    }

    function it_launch_creates_token_and_deploys_auction() {
        require(launchToken != address(0), "no launch token");
        require(IERC20(launchToken).totalSupply() == SUPPLY, "wrong launch supply");
        require(IERC20(launchToken).balanceOf(address(auction)) == SUPPLY, "auction didn't receive tokens");
        require(auction.notified(), "onTokensReceived not called");
        require(auction.totalSupply() == SUPPLY, "auction misremembers supply");
        require(auction.startTime() > block.timestamp, "auction opens in past");
    }

    function it_bid_before_open_reverts() {
        bool reverted = false;
        try alice.do(address(quote), "approve", address(auction), uint256(1000)) {} catch { reverted = true; }
        require(!reverted, "approve should succeed");
        try alice.do(address(auction), "commitBid", uint256(10), uint256(5)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "bid should revert before window open");
    }

    function it_settle_before_close_reverts() {
        // Move past the open but not past close.
        fastForward(START_DELAY + 1);
        _bid(alice, 100, 5);

        bool reverted = false;
        try auction.settle() {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "settle should revert before close");
    }

    /// @notice Oversubscribed auction with distinct prices: the top three
    /// bids exactly consume the 1000-token supply, the lowest bid loses
    /// entirely, and the clearing price equals the marginal (third) bid.
    function it_full_auction_oversubscribed_distinct_prices() {
        fastForward(START_DELAY + 1);

        // Aggregate demand: 400 @ 10, 300 @ 8, 300 @ 6, 200 @ 4 = 1200 qty,
        // supply = 1000. Top three clear exactly; dave loses.
        _bid(alice, 400, 10);
        _bid(bob,   300, 8);
        _bid(carol, 300, 6);
        _bid(dave,  200, 4);

        fastForward(AUCTION_LEN);
        auction.settle();

        require(auction.settled(), "not settled");
        require(auction.clearingPrice() == 6, "wrong clearing price");
        require(auction.totalFilled() == SUPPLY, "supply not fully filled");

        _assertClaim(alice, 400, 400 * (10 - 6));
        _assertClaim(bob,   300, 300 * ( 8 - 6));
        _assertClaim(carol, 300, 300 * ( 6 - 6));
        _assertLoserClaim(dave, 200 * 4);

        // All launch tokens dispersed to winners, none stuck.
        require(IERC20(launchToken).balanceOf(address(auction)) == 0, "auction retained launch tokens");
        // No quote stuck either — winners paid clearing*filled, losers refunded.
        uint256 expectedProceeds = SUPPLY * auction.clearingPrice();
        require(quote.balanceOf(address(auction)) == expectedProceeds, "wrong quote retained as proceeds");
    }

    /// @notice Under-subscribed auction: total demand below supply, all
    /// bidders win their full quantity at the lowest bid price.
    function it_undersubscribed_all_fill_at_lowest_price() {
        fastForward(START_DELAY + 1);

        _bid(alice, 200, 10);
        _bid(bob,   200, 7);
        _bid(carol, 200, 3);

        fastForward(AUCTION_LEN);
        auction.settle();

        require(auction.settled(), "not settled");
        require(auction.clearingPrice() == 3, "clearing price should be lowest bid");
        require(auction.totalFilled() == 600, "unexpected fill");

        _assertClaim(alice, 200, 200 * (10 - 3));
        _assertClaim(bob,   200, 200 * ( 7 - 3));
        _assertClaim(carol, 200, 200 * ( 3 - 3));

        // Unsold tokens remain in the auction.
        require(IERC20(launchToken).balanceOf(address(auction)) == SUPPLY - 600, "unsold tokens missing");
    }

    /// @notice Marginal bid gets a partial fill; it still sets the clearing
    /// price and receives a proportional refund.
    function it_partial_fill_at_margin() {
        fastForward(START_DELAY + 1);

        // 600 @ 9 + 600 @ 5 = 1200 qty, supply = 1000. Bob's 600 @ 5 gets
        // filled 400, refunded for the 200 unfilled.
        _bid(alice, 600, 9);
        _bid(bob,   600, 5);

        fastForward(AUCTION_LEN);
        auction.settle();

        require(auction.clearingPrice() == 5, "wrong clearing price");
        require(auction.totalFilled() == SUPPLY, "should fill fully");

        _assertClaim(alice, 600, 600 * (9 - 5));
        // Bob: filled 400 at clearing 5, paid 600*5, owes 400*5, refund =
        // 600*5 - 400*5 = 1000.
        _assertClaim(bob, 400, 600 * 5 - 400 * 5);
    }

    function _assertClaim(User who, uint256 expectedTokens, uint256 expectedRefund) internal {
        uint256 tokenBefore = IERC20(launchToken).balanceOf(address(who));
        uint256 quoteBefore = quote.balanceOf(address(who));
        who.do(address(auction), "claim");
        uint256 tokenAfter = IERC20(launchToken).balanceOf(address(who));
        uint256 quoteAfter = quote.balanceOf(address(who));
        require(tokenAfter - tokenBefore == expectedTokens, "winner received wrong token amount");
        require(quoteAfter - quoteBefore == expectedRefund, "winner received wrong refund");
    }

    function _assertLoserClaim(User who, uint256 expectedRefund) internal {
        uint256 tokenBefore = IERC20(launchToken).balanceOf(address(who));
        uint256 quoteBefore = quote.balanceOf(address(who));
        who.do(address(auction), "claim");
        uint256 tokenAfter = IERC20(launchToken).balanceOf(address(who));
        uint256 quoteAfter = quote.balanceOf(address(who));
        require(tokenAfter == tokenBefore, "loser unexpectedly received tokens");
        require(quoteAfter - quoteBefore == expectedRefund, "loser refund wrong");
    }
}

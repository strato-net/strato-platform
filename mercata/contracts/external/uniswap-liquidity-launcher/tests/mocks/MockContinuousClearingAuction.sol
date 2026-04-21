// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IDistributionStrategy} from "../../src/interfaces/IDistributionStrategy.sol";
import {IDistributionContract} from "../../src/interfaces/IDistributionContract.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice A simplified continuous-clearing-auction:
/// - bidders commit (quantity, pricePerUnit) during an open window, paying
///   quantity*price in a quote ERC20 held as escrow;
/// - once the window closes and the launched tokens have arrived, anyone
///   can settle;
/// - settlement sorts bids by price descending and fills them until the
///   token supply runs out, with a partial fill at the margin;
/// - clearing price is the price of the last bid that received a fill;
/// - winners claim their tokens plus a refund of (theirPrice-clearing) per
///   filled unit; losers claim their entire escrow back.
contract MockContinuousClearingAuction is IDistributionContract {
    struct Bid {
        address bidder;
        uint256 quantity;
        uint256 pricePerUnit;
        uint256 filled;
        bool claimed;
    }

    address public auctionToken;
    IERC20 public quoteToken;
    uint256 public startTime;
    uint256 public endTime;
    uint256 public totalSupply;

    bool public notified;
    bool public settled;
    uint256 public clearingPrice;
    uint256 public totalFilled;

    Bid[] public bids;
    mapping(address => uint256[]) public bidIndicesOf;

    event BidPlaced(address indexed bidder, uint256 quantity, uint256 pricePerUnit, uint256 index);
    event Settled(uint256 clearingPrice, uint256 totalFilled);
    event Claimed(address indexed bidder, uint256 tokensReceived, uint256 quoteRefunded);

    error AuctionNotOpen();
    error AuctionStillOpen();
    error AuctionAlreadySettled();
    error AuctionNotSettled();
    error TokensNotReceived();
    error NothingToClaim();

    function init(address _token, uint256 _totalSupply, address _quoteToken, uint256 _start, uint256 _end) external {
        auctionToken = _token;
        totalSupply = _totalSupply;
        quoteToken = IERC20(_quoteToken);
        startTime = _start;
        endTime = _end;
    }

    function onTokensReceived() external override {
        uint256 bal = IERC20(auctionToken).balanceOf(address(this));
        if (bal != totalSupply) revert InvalidAmountReceived(totalSupply, bal);
        notified = true;
    }

    /// @notice Commit a bid for `quantity` tokens at `pricePerUnit` quote
    /// per unit. Requires the bidder to have approved quoteToken to this
    /// contract for at least `quantity * pricePerUnit`.
    function commitBid(uint256 quantity, uint256 pricePerUnit) external returns (uint256 index) {
        if (block.timestamp < startTime || block.timestamp >= endTime) revert AuctionNotOpen();
        if (settled) revert AuctionAlreadySettled();
        uint256 cost = quantity * pricePerUnit;
        require(quoteToken.transferFrom(msg.sender, address(this), cost), "CCA: quote transferFrom");

        index = bids.length;
        bids.push(Bid({
            bidder: msg.sender,
            quantity: quantity,
            pricePerUnit: pricePerUnit,
            filled: 0,
            claimed: false
        }));
        bidIndicesOf[msg.sender].push(index);
        emit BidPlaced(msg.sender, quantity, pricePerUnit, index);
    }

    /// @notice Finalise the auction. Assigns fills from highest-price bid
    /// down, records the clearing price, and lets bidders claim.
    function settle() external {
        if (block.timestamp < endTime) revert AuctionStillOpen();
        if (settled) revert AuctionAlreadySettled();
        if (!notified) revert TokensNotReceived();

        uint256 remaining = totalSupply;
        uint256 lastFillPrice = 0;

        // Repeatedly pick the highest-price unfilled bid and fill it.
        // O(n^2) over bids; fine for test-scale auctions.
        while (remaining > 0) {
            uint256 bestIdx = bids.length;
            uint256 bestPrice = 0;
            for (uint256 i = 0; i < bids.length; i++) {
                Bid storage b = bids[i];
                if (b.filled == b.quantity) continue;
                if (bestIdx == bids.length || b.pricePerUnit > bestPrice) {
                    bestIdx = i;
                    bestPrice = b.pricePerUnit;
                }
            }
            if (bestIdx == bids.length) break;

            Bid storage winner = bids[bestIdx];
            uint256 want = winner.quantity - winner.filled;
            uint256 fill = want > remaining ? remaining : want;
            winner.filled += fill;
            remaining -= fill;
            lastFillPrice = winner.pricePerUnit;
        }

        clearingPrice = lastFillPrice;
        totalFilled = totalSupply - remaining;
        settled = true;
        emit Settled(clearingPrice, totalFilled);
    }

    /// @notice Claim tokens and any refund owed after settlement.
    function claim() external returns (uint256 tokensReceived, uint256 quoteRefunded) {
        if (!settled) revert AuctionNotSettled();
        uint256[] storage indices = bidIndicesOf[msg.sender];
        require(indices.length > 0, "CCA: no bids");

        for (uint256 k = 0; k < indices.length; k++) {
            Bid storage b = bids[indices[k]];
            if (b.claimed) continue;
            b.claimed = true;
            uint256 owedQuote = b.filled * clearingPrice;
            uint256 paidQuote = b.quantity * b.pricePerUnit;
            uint256 refund = paidQuote - owedQuote;
            tokensReceived += b.filled;
            quoteRefunded += refund;
        }
        if (tokensReceived == 0 && quoteRefunded == 0) revert NothingToClaim();
        if (tokensReceived > 0) {
            require(IERC20(auctionToken).transfer(msg.sender, tokensReceived), "CCA: token transfer");
        }
        if (quoteRefunded > 0) {
            require(quoteToken.transfer(msg.sender, quoteRefunded), "CCA: quote refund");
        }
        emit Claimed(msg.sender, tokensReceived, quoteRefunded);
    }

    function bidCount() external view returns (uint256) {
        return bids.length;
    }
}

/// @notice IDistributionStrategy that deploys one MockContinuousClearingAuction
/// per call. The auction parameters (quote token + open window) are
/// preconfigured via @prepareAuction@ before @initializeDistribution@ runs.
/// We keep them out of @configData@ because SolidVM's runtime @abi.decode@
/// doesn't yet support decoding a tuple of type identifiers.
contract MockCCAFactory is IDistributionStrategy {
    event AuctionDeployed(address indexed auction, address indexed token);

    address public pendingQuoteToken;
    uint256 public pendingStartTime;
    uint256 public pendingEndTime;

    function prepareAuction(address quoteToken, uint256 startTime, uint256 endTime) external {
        pendingQuoteToken = quoteToken;
        pendingStartTime = startTime;
        pendingEndTime = endTime;
    }

    function initializeDistribution(
        address tokenAddress,
        uint256 totalSupply,
        bytes calldata /* configData */,
        bytes32 /* salt */
    ) external override returns (IDistributionContract distributionContract) {
        MockContinuousClearingAuction auction = new MockContinuousClearingAuction();
        auction.init(tokenAddress, totalSupply, pendingQuoteToken, pendingStartTime, pendingEndTime);
        distributionContract = IDistributionContract(address(auction));
        emit DistributionInitialized(address(auction), tokenAddress, totalSupply);
        emit AuctionDeployed(address(auction), tokenAddress);
    }
}

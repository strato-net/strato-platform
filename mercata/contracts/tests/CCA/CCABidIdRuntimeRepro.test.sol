// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "../../concrete/BaseCodeCollection.sol";

struct ReproBid {
    uint256 maxPrice;
    uint256 amount;
    address owner;
}

contract MiniBidIdRuntimeRepro {
    uint256 public constant FLOOR_PRICE = 2 ** 32;

    uint256 private _nextBidId;
    mapping(uint256 => ReproBid) private _bids;

    uint256 public sumDemandAboveClearingQ96;
    uint256 public storedClearingPrice = FLOOR_PRICE;

    function _createBid(uint256 amount, address owner, uint256 maxPrice)
        internal
        returns (ReproBid memory bid, uint256 bidId)
    {
        bid.maxPrice = maxPrice;
        bid.amount = amount;
        bid.owner = owner;

        uint256 currentBidId = _nextBidId;
        _nextBidId = currentBidId + 1;
        bidId = currentBidId;
        _bids[currentBidId] = bid;
    }

    function submitBid(
        uint256 maxPrice,
        uint128 amount,
        address owner,
        uint256 prevTickPrice,
        bytes memory hookData
    ) public returns (uint256 bidId) {
        require(owner != address(0), "owner zero");
        if (prevTickPrice == FLOOR_PRICE && hookData.length == 0) {
        }

        ReproBid memory bid;
        (bid, bidId) = _createBid(amount, owner, maxPrice);
        sumDemandAboveClearingQ96 += uint256(amount) << 96;
    }

    function submitBid(uint256 maxPrice, uint128 amount, address owner, bytes memory hookData)
        public
        returns (uint256 bidId)
    {
        return submitBid(maxPrice, amount, owner, FLOOR_PRICE, hookData);
    }

    function nextBidId() external view returns (uint256) {
        return _nextBidId;
    }

    function bids(uint256 bidId) external view returns (ReproBid memory) {
        return _bids[bidId];
    }

    function checkpointLike() external view returns (uint256 clearingPrice, uint256 demand, uint256 nextBidId_) {
        return (storedClearingPrice, sumDemandAboveClearingQ96, _nextBidId);
    }
}

contract Describe_CCA_BidId_Runtime_Repro {
    uint256 constant FLOOR_PRICE = 2 ** 32;
    uint128 constant BID_AMOUNT = 5000 ether;

    MiniBidIdRuntimeRepro repro;
    uint256 bidId;

    function beforeAll() public {
        repro = new MiniBidIdRuntimeRepro();
    }

    function it_aa_explicit_five_arg_submit_keeps_bid_id_and_storage_consistent() public {
        bytes memory emptyHookData;
        bidId = repro.submitBid(FLOOR_PRICE + 2, BID_AMOUNT, address(this), FLOOR_PRICE, emptyHookData);

        log("returned bidId", bidId);
        log("nextBidId", repro.nextBidId());
        log("sumDemandAboveClearingQ96", repro.sumDemandAboveClearingQ96());

        ReproBid memory bidZero = repro.bids(0);
        log("bid0 owner", bidZero.owner);
        log("bid0 maxPrice", bidZero.maxPrice);

        require(bidId == 0, "five-arg submit should return bid id zero");
        require(repro.nextBidId() == 1, "nextBidId should advance to one");
        require(bidZero.owner == address(this), "bid zero owner mismatch");
        require(bidZero.maxPrice == FLOOR_PRICE + 2, "bid zero max price mismatch");
    }

    function it_ab_checkpoint_like_view_stays_consistent_after_submit() public {
        (uint256 clearingPrice, uint256 demand, uint256 nextBidId_) = repro.checkpointLike();

        log("checkpointLike clearingPrice", clearingPrice);
        log("checkpointLike demand", demand);
        log("checkpointLike nextBidId", nextBidId_);

        require(clearingPrice == FLOOR_PRICE, "checkpointLike clearing price mismatch");
        require(demand > 0, "checkpointLike demand should be non-zero");
        require(nextBidId_ == 1, "checkpointLike nextBidId mismatch");
    }
}

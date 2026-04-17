// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "../../concrete/BaseCodeCollection.sol";

struct RuntimeBugBid {
    uint256 value;
    address owner;
}

contract OverloadedBytesDispatchRepro {
    uint256 public constant DEFAULT_HINT = 123;

    uint256 public submitCount;
    uint256 public lastHint;
    address public lastOwner;
    uint256 public lastAmount;

    function submit(uint256 amount, address owner, uint256 hint, bytes memory hookData) public returns (uint256) {
        if (hookData.length == 0) {
        }

        submitCount += 1;
        lastHint = hint;
        lastOwner = owner;
        lastAmount = amount;
        return hint;
    }

    function submit(uint256 amount, address owner, bytes memory hookData) public returns (uint256) {
        return submit(amount, owner, DEFAULT_HINT, hookData);
    }
}

contract BidIdAndViewRuntimeRepro {
    uint256 private _nextBidId;
    mapping(uint256 => RuntimeBugBid) private _bids;

    uint256 public totalValue;
    uint256 public storedSentinel = 777;

    function createBid(uint256 value, address owner) public returns (uint256 bidId) {
        RuntimeBugBid memory bid;
        bid.value = value;
        bid.owner = owner;

        uint256 currentBidId = _nextBidId;
        _nextBidId = currentBidId + 1;
        bidId = currentBidId;
        _bids[currentBidId] = bid;
        totalValue += value;
    }

    function nextBidId() external view returns (uint256) {
        return _nextBidId;
    }

    function bids(uint256 bidId) external view returns (RuntimeBugBid memory) {
        return _bids[bidId];
    }

    function summary() external view returns (uint256 sentinel, uint256 value, uint256 nextBidId_) {
        return (storedSentinel, totalValue, _nextBidId);
    }
}

contract Describe_SolidVM_Overloaded_Bytes_Dispatch_Repro {
    OverloadedBytesDispatchRepro repro;

    function beforeAll() public {
        repro = new OverloadedBytesDispatchRepro();
    }

    function it_aa_four_arg_overload_should_route_to_five_arg_path() public {
        bytes memory emptyHookData;
        uint256 returnedHint = repro.submit(5000, address(this), emptyHookData);

        log("returnedHint", returnedHint);
        log("submitCount", repro.submitCount());
        log("lastHint", repro.lastHint());
        log("lastAmount", repro.lastAmount());
        log("lastOwner", repro.lastOwner());

        require(returnedHint == 123, "four-arg overload returned wrong hint");
        require(repro.submitCount() == 1, "four-arg overload did not hit submit");
        require(repro.lastHint() == 123, "four-arg overload did not preserve default hint");
        require(repro.lastAmount() == 5000, "four-arg overload did not preserve amount");
        require(repro.lastOwner() == address(this), "four-arg overload did not preserve owner");
    }

    function it_ab_direct_five_arg_call_is_control_case() public {
        bytes memory emptyHookData;
        uint256 returnedHint = repro.submit(7000, address(this), 456, emptyHookData);

        log("control returnedHint", returnedHint);
        log("control submitCount", repro.submitCount());
        log("control lastHint", repro.lastHint());

        require(returnedHint == 456, "five-arg control returned wrong hint");
        require(repro.submitCount() == 1, "five-arg control did not increment submit count");
        require(repro.lastHint() == 456, "five-arg control did not preserve hint");
    }
}

contract Describe_SolidVM_Bid_Id_And_View_Repro {
    BidIdAndViewRuntimeRepro repro;

    function beforeAll() public {
        repro = new BidIdAndViewRuntimeRepro();
    }

    function it_aa_create_bid_should_return_zero_and_store_bid_zero() public {
        uint256 bidId = repro.createBid(42, address(this));

        log("returned bidId", bidId);
        log("nextBidId", repro.nextBidId());
        log("totalValue", repro.totalValue());

        RuntimeBugBid memory bidZero = repro.bids(0);
        log("bid0 owner", bidZero.owner);
        log("bid0 value", bidZero.value);

        require(bidId == 0, "createBid should return bid id zero");
        require(repro.nextBidId() == 1, "nextBidId should advance to one");
        require(bidZero.owner == address(this), "bid zero owner mismatch");
        require(bidZero.value == 42, "bid zero value mismatch");
    }

    function it_ab_summary_should_return_values_not_storage_references() public {
        (uint256 sentinel, uint256 value, uint256 nextBidId_) = repro.summary();

        log("summary sentinel", sentinel);
        log("summary value", value);
        log("summary nextBidId", nextBidId_);

        require(sentinel == 777, "summary sentinel mismatch");
        require(value == 42, "summary value mismatch");
        require(nextBidId_ == 1, "summary nextBidId mismatch");
    }
}

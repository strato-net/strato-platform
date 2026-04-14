// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../external/uniswap-cca/src/ContinuousClearingAuction.sol";
import "../../external/uniswap-cca/src/libraries/StepLib.sol";

contract MockERC20 is ERC20, Ownable {
    constructor(string _name, string _symbol, address _owner) ERC20(_name, _symbol) Ownable(_owner) {
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return 18;
    }

    function getBalance(address owner) external view returns (uint256) {
        return balanceOf(owner);
    }
}

contract Describe_CCA_NoBids_Smoke {
    MockERC20 saleToken;
    MockERC20 currencyToken;
    ContinuousClearingAuction auction;

    address tokensRecipient;
    address fundsRecipient;

    uint128 constant TOTAL_SUPPLY = 1000 ether;
    uint256 constant FLOOR_PRICE = 2 ** 32;
    uint256 constant TICK_SPACING = 2;

    function _singleStepData(uint24 mps, uint40 blockDelta) internal pure returns (bytes memory) {
        bytes memory data = new bytes(8);
        data[0] = uint8(mps >> 16);
        data[1] = uint8(mps >> 8);
        data[2] = uint8(mps);
        data[3] = uint8(blockDelta >> 32);
        data[4] = uint8(blockDelta >> 24);
        data[5] = uint8(blockDelta >> 16);
        data[6] = uint8(blockDelta >> 8);
        data[7] = uint8(blockDelta);
        return data;
    }

    function beforeAll() public {
        saleToken = new MockERC20("Sale Token", "SALE", address(this));
        currencyToken = new MockERC20("Currency Token", "CUR", address(this));
        tokensRecipient = address(0x1001);
        fundsRecipient = address(0x1002);

        AuctionParameters memory params;
        params.currency = address(currencyToken);
        params.tokensRecipient = tokensRecipient;
        params.fundsRecipient = fundsRecipient;
        params.startBlock = 0;
        params.endBlock = 1;
        params.claimBlock = 2;
        params.tickSpacing = TICK_SPACING;
        params.validationHook = address(0);
        params.floorPrice = FLOOR_PRICE;
        params.requiredCurrencyRaised = 1 ether;
        params.auctionStepsData = _singleStepData(1e7, 1);

        (uint24 decodedMps, uint40 decodedBlockDelta) = StepLib.get(params.auctionStepsData, 0);
        require(decodedMps == 1e7, "decoded mps mismatch");
        require(decodedBlockDelta == 1, "decoded block delta mismatch: " + string(uint256(decodedBlockDelta)));

        auction = new ContinuousClearingAuction(address(saleToken), TOTAL_SUPPLY, params);
        saleToken.mint(address(this), TOTAL_SUPPLY);
        require(saleToken.transfer(address(auction), TOTAL_SUPPLY), "transfer sale tokens failed");
    }

    function it_aa_receives_tokens() public {
        auction.onTokensReceived();
        require(saleToken.getBalance(address(auction)) == TOTAL_SUPPLY, "auction token balance mismatch");
        require(auction.totalSupply() == TOTAL_SUPPLY, "total supply mismatch");
    }

    function it_ab_has_zero_raised_currency_without_bids() public {
        require(auction.currencyRaised() == 0, "currency raised should be zero");
        require(auction.totalCleared() == 0, "total cleared should be zero");
        require(!auction.isGraduated(), "auction should not graduate without bids");
    }

    function it_ac_keeps_all_sale_tokens_before_finalization() public {
        require(saleToken.getBalance(address(auction)) == TOTAL_SUPPLY, "sale tokens should remain in auction");
        require(saleToken.getBalance(tokensRecipient) == 0, "tokens recipient should not receive funds early");
    }
}

contract Describe_CCA_SingleWinningBid_Smoke {
    MockERC20 saleToken;
    MockERC20 currencyToken;
    ContinuousClearingAuction auction;

    address tokensRecipient;
    address fundsRecipient;

    uint128 constant TOTAL_SUPPLY = 1000 ether;
    uint128 constant BID_AMOUNT = 5000 ether;
    uint256 constant FLOOR_PRICE = 2 ** 32;
    uint256 constant TICK_SPACING = 2;
    uint256 bidId;

    function _singleStepData(uint24 mps, uint40 blockDelta) internal pure returns (bytes memory) {
        bytes memory data = new bytes(8);
        data[0] = uint8(mps >> 16);
        data[1] = uint8(mps >> 8);
        data[2] = uint8(mps);
        data[3] = uint8(blockDelta >> 32);
        data[4] = uint8(blockDelta >> 24);
        data[5] = uint8(blockDelta >> 16);
        data[6] = uint8(blockDelta >> 8);
        data[7] = uint8(blockDelta);
        return data;
    }

    function beforeAll() public {
        saleToken = new MockERC20("Sale Token", "SALE", address(this));
        currencyToken = new MockERC20("Currency Token", "CUR", address(this));
        tokensRecipient = address(0x2001);
        fundsRecipient = address(0x2002);

        AuctionParameters memory params;
        params.currency = address(currencyToken);
        params.tokensRecipient = tokensRecipient;
        params.fundsRecipient = fundsRecipient;
        params.startBlock = 0;
        params.endBlock = 100;
        params.claimBlock = 101;
        params.tickSpacing = TICK_SPACING;
        params.validationHook = address(0);
        params.floorPrice = FLOOR_PRICE;
        params.requiredCurrencyRaised = 1;
        params.auctionStepsData = _singleStepData(1e5, 100);

        (uint24 decodedMps, uint40 decodedBlockDelta) = StepLib.get(params.auctionStepsData, 0);
        require(decodedMps == 1e5, "decoded mps mismatch");
        require(decodedBlockDelta == 100, "decoded block delta mismatch: " + string(uint256(decodedBlockDelta)));

        auction = new ContinuousClearingAuction(address(saleToken), TOTAL_SUPPLY, params);
        saleToken.mint(address(this), TOTAL_SUPPLY);
        currencyToken.mint(address(this), BID_AMOUNT);
        require(saleToken.transfer(address(auction), TOTAL_SUPPLY), "transfer sale tokens failed");
        require(currencyToken.approve(address(auction), BID_AMOUNT), "approve currency failed");
        auction.onTokensReceived();
    }

    function it_aa_submits_a_bid() public {
        bytes emptyHookData;
        bidId = auction.submitBid(FLOOR_PRICE + TICK_SPACING, BID_AMOUNT, address(this), emptyHookData);
        require(auction.nextBidId() == bidId + 1, "next bid id should advance after submission");
        require(auction.currency() == address(currencyToken), "currency token mismatch");
        require(auction.sumCurrencyDemandAboveClearingQ96() > 0, "demand above clearing should increase");
    }

    function it_ab_updates_checkpoint_state() public {
        Checkpoint memory cp = auction.checkpoint();
        require(cp.clearingPrice >= FLOOR_PRICE, "clearing price should stay above floor");
        require(auction.clearingPrice() >= FLOOR_PRICE, "stored clearing price should stay above floor");
    }

    function it_ac_tracks_bid_and_graduation_state() public {
        Bid memory bid = auction.bids(bidId);
        require(bid.owner == address(this), "bid owner mismatch");
        require(bid.maxPrice == FLOOR_PRICE + TICK_SPACING, "bid max price mismatch");
        require(auction.isGraduated(), "auction should graduate after funded bid");
        require(auction.currencyRaised() >= 0, "currency raised should be readable");
    }
}

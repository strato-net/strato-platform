import "../../concrete/Staking/FeeRouter.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../concrete/Pools/PoolV3Factory.sol";
import "../Util.sol";

contract record MockGovernance {
    address public stakingContract;
    function setStakingContract(address s) public { stakingContract = s; }
}

contract record MockStaking {
    uint public processed;
    bool public revertOnProcess;
    bool public refuseRewards;
    address public stratoToken;
    mapping(address => uint) public record rewarded;
    function setStratoToken(address t) public { stratoToken = t; }
    function setRevertOnProcess(bool r) public { revertOnProcess = r; }
    function setRefuseRewards(bool r) public { refuseRewards = r; }
    function processBlock() external {
        require(!revertOnProcess, "MockStaking: boom");
        processed += 1;
    }
    // Pulls the reward like StratoStaking.creditBlockReward.
    function creditBlockReward(address validator, uint amount) external {
        require(!refuseRewards, "MockStaking: validator not listed");
        require(Token(stratoToken).transferFrom(msg.sender, address(this), amount), "MockStaking: pull failed");
        rewarded[validator] += amount;
    }
}

// Helium's genesis MercataGovernance has no stakingContract() at all, so the lookup
// fails outright rather than answering zero. payFees has to survive that: a throw
// here would fail every transaction on the chain.
contract record LegacyGovernance {
    uint public validators;
    function voteToAddValidator(address proposed) public { validators += 1; }
}

contract record MockVoucher {
    mapping(address => uint) public balances;
    function mint(address to, uint amount) public { balances[to] += amount; }
    function burn(address from, uint amount) public {
        require(balances[msg.sender] >= amount, "no voucher");
        balances[msg.sender] -= amount;
    }
}

// Stands in for DeciderState(0xDEC1DE02): names the installed router.
contract record MockDeciderState {
    address public impl;
    function setImpl(address i) public { impl = i; }
    function getImplContract() public view returns (address) { return impl; }
}

// The router reads its addresses through internal getters; the harness serves them
// from storage. Because SolidVM storage is name-keyed, a Signer that *is* a harness
// and DELEGATECALLs the router runs the router's code against its own addresses —
// exactly the signer-context execution the platform performs for payFees.
contract record FeeRouterHarness is FeeRouter {
    address public voucherAddr;
    address public usdstAddr;
    address public governanceAddr;
    address public stakingFallbackAddr;
    address public stratoAddr;
    address public poolAddr;
    address public deciderStateAddr;
    uint public minLiquidity;

    function configure(address v, address u, address g, address d) public {
        voucherAddr = v;
        usdstAddr = u;
        governanceAddr = g;
        deciderStateAddr = d;
    }

    function configureStrato(address s, address p) public {
        stratoAddr = s;
        poolAddr = p;
    }

    function setStakingFallback(address s) public { stakingFallbackAddr = s; }
    function setMinLiquidity(uint l) public { minLiquidity = l; }

    function _voucher() internal view override returns (address) { return voucherAddr; }
    function _usdst() internal view override returns (address) { return usdstAddr; }
    function _governance() internal view override returns (address) { return governanceAddr; }
    function _deciderState() internal view override returns (address) { return deciderStateAddr; }
    function _stakingFallback() internal view override returns (address) { return stakingFallbackAddr; }
    function _strato() internal view override returns (address) { return stratoAddr; }
    function _pool() internal view override returns (address) { return poolAddr; }
    function _minPoolLiquidity() internal view override returns (uint) { return minLiquidity; }
}

contract record Signer is FeeRouterHarness {
    function pay(address router) public {
        address(router).delegatecall("payFees");
    }
}

contract Describe_FeeRouter {
    address constant PROPOSER = address(0xaaaa);
    uint constant Q192 = 6277101735386680763835789423207666416102355444464034512896;
    uint constant WINDOW = 1800; // FeeRouter._twapWindow
    uint constant GRACE = 3600;  // FeeRouter._priceGrace
    int constant FULL_RANGE = 887220; // widest tick multiple of the 0.30% tier's spacing
    int constant HALF_PRICE_TICK = -6932; // 1.0001^-6932 = 0.50004
    uint constant BIG = 100000000e18;

    TokenFactory factory;
    Token usdst;
    Token strato;
    MockGovernance gov;
    MockStaking staking;
    MockVoucher voucher;
    MockDeciderState decider;
    FeeRouterHarness router;
    Signer signer;
    User feeCollector;
    PoolV3Factory poolFactory;
    PoolV3 pool;

    function beforeAll() public {
        feeCollector = new User();
    }

    function beforeEach() public {
        factory = new TokenFactory(address(this));
        usdst = _token("USDST");
        strato = _token("STRATO");

        gov = new MockGovernance();
        staking = new MockStaking();
        voucher = new MockVoucher();
        decider = new MockDeciderState();
        router = new FeeRouterHarness();
        decider.setImpl(address(router));
        signer = _signer();
        // The router prices in its own storage, so it needs the addresses too.
        router.configure(address(voucher), address(usdst), address(gov), address(decider));
        router.configureStrato(address(strato), address(0));
    }

    // Block context set in beforeEach does not reach the test body, so every test
    // that drives payBlockRewards starts a block of its own. Off block 0 too: the
    // latch's zero default is indistinguishable from "already rewarded" there,
    // which only ever coincides with genesis.
    function _newBlock() internal {
        fastForward(1, 1);
        setBlockContext(PROPOSER, address(0), address(0), 0);
    }

    function _token(string symbol) internal returns (Token) {
        Token t = Token(factory.createTokenWithInitialOwner(
            symbol, symbol + " Token", new string[](0), new string[](0), new string[](0), symbol, 0, 18, address(this)));
        t.setStatus(2);
        return t;
    }

    // A signer pointed at the mocks, holding 1 STRATO and nothing else.
    function _signer() internal returns (Signer) {
        Signer s = new Signer();
        s.configure(address(voucher), address(usdst), address(gov), address(decider));
        s.configureStrato(address(strato), address(0));
        strato.mint(address(s), 1e18);
        return s;
    }

    function _signerWithVoucher() internal returns (Signer) {
        Signer s = _signer();
        voucher.mint(address(s), 1e18);
        return s;
    }

    // ---- canonical pool ----

    // A STRATO/USDST PoolV3 at `tick` (token1 per token0 = 1.0001^tick) with full-range
    // liquidity, named as the router's canonical pool but not yet warm.
    function _pool(int tick, bool stratoFirst) internal returns (PoolV3) {
        _newBlock();
        poolFactory = new PoolV3Factory(address(this));
        poolFactory.initialize(address(factory), address(feeCollector));
        address a = stratoFirst ? address(strato) : address(usdst);
        address b = stratoFirst ? address(usdst) : address(strato);
        pool = PoolV3(poolFactory.createPoolV3(a, b, 3000, TickMath.getSqrtRatioAtTick(tick)));
        pool.increaseObservationCardinalityNext(16);

        strato.mint(address(this), BIG);
        usdst.mint(address(this), BIG);
        strato.approve(address(pool), BIG);
        usdst.approve(address(pool), BIG);
        pool.mint(address(this), -FULL_RANGE, FULL_RANGE, 1e24, BIG, BIG, block.timestamp + 3600);

        router.configureStrato(address(strato), address(pool));
        return pool;
    }

    // A warm canonical pool: a full window of history and this block's fee quoted.
    function _pricedPool(int tick, bool stratoFirst) internal returns (PoolV3) {
        PoolV3 p = _pool(tick, stratoFirst);
        fastForward(WINDOW, 1);
        router.payBlockRewards();
        return p;
    }

    function _swapStratoIn(uint amount) internal {
        strato.approve(address(pool), amount);
        bool zeroForOne = address(pool.token0()) == address(strato);
        pool.swap(address(this), zeroForOne, int(amount), 0, 1, block.timestamp + 3600);
    }

    // The fee the router should quote while the pool holds its current tick.
    function _expectedFee() internal view returns (uint) {
        uint s = pool.getSqrtRatioAtTick(pool.currentTick());
        uint ratio = s * s;
        if (address(pool.token0()) == address(strato)) return (1e16 * Q192 + ratio - 1) / ratio;
        return (1e16 * ratio + Q192 - 1) / Q192;
    }

    function _quotedFee() internal view returns (uint) {
        (uint fee, , bool valid) = router.stratoFeeQuote();
        require(valid, "quote should be valid");
        return fee;
    }

    function _paymentReverts(Signer s) internal returns (bool) {
        bool reverted = false;
        try s.pay(address(router)) {
        } catch {
            reverted = true;
        }
        return reverted;
    }

    // ---- pricing from the canonical pool ----

    function it_quotes_a_cents_worth_of_strato_from_the_pool() public {
        _pricedPool(0, true); // 1 USDST per STRATO
        require(_quotedFee() == 1e16, "0.01 STRATO at $1");
        require(router.priceVersion() == 1, "first price");
    }

    function it_prices_either_token_order() public {
        _pricedPool(HALF_PRICE_TICK, true); // token1/token0 = 0.5 USDST per STRATO
        uint fee = _quotedFee();
        require(fee == _expectedFee(), "fee follows the held price with STRATO as token0");
        require(fee > 199e14 && fee < 201e14, "about 0.02 STRATO at $0.50");

        beforeEach();
        _pricedPool(-HALF_PRICE_TICK, false); // token1/token0 = 2 STRATO per USDST
        fee = _quotedFee();
        require(fee == _expectedFee(), "fee follows the held price with STRATO as token1");
        require(fee > 199e14 && fee < 201e14, "about 0.02 STRATO at $0.50");
    }

    function it_rounds_the_strato_fee_up() public {
        _pricedPool(HALF_PRICE_TICK, true);
        uint fee = _quotedFee();
        uint s = pool.sqrtPriceX96();
        require(fee * s * s >= 1e16 * Q192, "never short of a cent");
        require((fee - 1) * s * s < 1e16 * Q192, "by less than a wei");
    }

    function it_freezes_one_fee_per_block() public {
        _pricedPool(0, true);
        router.payBlockRewards();
        router.payBlockRewards();
        require(router.priceVersion() == 1, "repeat calls in one block do not reprice");

        Signer other = _signer();
        signer.pay(address(router));
        other.pay(address(router));
        require(strato.balanceOf(address(signer)) == 1e18 - 1e16, "first signer paid the block's fee");
        require(strato.balanceOf(address(other)) == 1e18 - 1e16, "second signer paid the same fee");

        fastForward(1, 1);
        router.payBlockRewards();
        require(router.priceVersion() == 2, "the next block prices again");
    }

    // A swap moves the spot price at once; the fee follows only as the window rolls.
    function it_charges_the_time_weighted_price_not_the_spot() public {
        _pricedPool(0, true);
        _swapStratoIn(1e23); // a tenth of the pool's STRATO depth: STRATO is now ~17% cheaper
        uint spotFee = _expectedFee();
        require(spotFee > 11e15, "spot moved by more than 10%");

        fastForward(1, 1);
        router.payBlockRewards();
        uint fee = _quotedFee();
        require(fee >= 1e16 && fee < 10003e12, "one second of the new price barely moves a 30-minute average");

        fastForward(WINDOW, 1);
        router.payBlockRewards();
        require(_quotedFee() == spotFee, "a full window later the fee is the new price");
    }

    function it_does_not_price_until_the_pool_has_a_full_window_of_history() public {
        _pool(0, true);
        fastForward(WINDOW - 1, 1);
        router.payBlockRewards();
        (uint fee, uint version, bool valid) = router.stratoFeeQuote();
        require(fee == 0 && version == 0 && !valid, "nothing quoted");
        require(_paymentReverts(signer), "STRATO is not accepted without a price");
        require(strato.balanceOf(address(signer)) == 1e18, "nothing burned");

        fastForward(1, 1);
        router.payBlockRewards();
        require(_quotedFee() == 1e16, "priced once the ring covers the window");
    }

    function it_ignores_a_pool_of_the_wrong_pair() public {
        Token other = _token("OTHER");
        usdst = other; // so the helper builds a STRATO/OTHER pool
        _pricedPool(0, true);
        (uint fee, , bool valid) = router.stratoFeeQuote();
        require(fee == 0 && !valid, "a STRATO/OTHER pool prices nothing");
    }

    function it_ignores_a_pool_below_the_liquidity_floor() public {
        router.setMinLiquidity(1e24 + 1);
        _pricedPool(0, true);
        (uint fee, , bool valid) = router.stratoFeeQuote();
        require(fee == 0 && !valid, "too thin to price");

        router.setMinLiquidity(1e24);
        fastForward(1, 1);
        router.payBlockRewards();
        require(_quotedFee() == 1e16, "priced at the floor");
    }

    function it_keeps_the_last_price_through_the_grace_period() public {
        _pricedPool(0, true);
        router.setMinLiquidity(BIG); // pricing fails from here on

        fastForward(GRACE, 1);
        router.payBlockRewards();
        require(router.priceVersion() == 1, "no new price");
        require(_quotedFee() == 1e16, "the last price is still chargeable at the edge of the grace period");
        signer.pay(address(router));
        require(strato.balanceOf(address(signer)) == 1e18 - 1e16, "paid at the last price");

        fastForward(1, 1);
        router.payBlockRewards();
        (, , bool valid) = router.stratoFeeQuote();
        require(!valid, "stale past the grace period");
        require(_paymentReverts(signer), "voucher-only until pricing recovers");
        Signer withVoucher = _signerWithVoucher();
        withVoucher.pay(address(router));
        require(voucher.balances(address(withVoucher)) == 0, "a voucher still pays");

        router.setMinLiquidity(0);
        fastForward(1, 1);
        router.payBlockRewards();
        require(router.priceVersion() == 2, "pricing recovered");
        signer.pay(address(router));
    }

    // ---- payment: one whole voucher, else burn STRATO ----

    function it_burns_the_strato_fee_rather_than_collecting_it() public {
        _pricedPool(0, true);
        uint supply = strato.totalSupply();

        signer.pay(address(router));
        require(strato.balanceOf(address(signer)) == 1e18 - 1e16, "signer paid 0.01 STRATO");
        require(strato.totalSupply() == supply - 1e16, "burned, not moved");
        require(strato.balanceOf(address(feeCollector)) == 0, "nothing to the collector");
        require(strato.balanceOf(address(router)) == 0, "nothing to the router");
        require(usdst.balanceOf(address(signer)) == 0, "no USDST involved");
    }

    function it_prefers_a_whole_voucher_over_strato() public {
        _pricedPool(0, true);
        Signer s = _signerWithVoucher();

        s.pay(address(router));
        require(voucher.balances(address(s)) == 0, "voucher burned");
        require(strato.balanceOf(address(s)) == 1e18, "STRATO untouched");
    }

    function it_burns_strato_when_the_voucher_is_fractional() public {
        _pricedPool(0, true);
        voucher.mint(address(signer), 1e18 - 1);

        signer.pay(address(router));
        require(voucher.balances(address(signer)) == 1e18 - 1, "part of a voucher is kept");
        require(strato.balanceOf(address(signer)) == 1e18 - 1e16, "STRATO paid instead");
    }

    function it_charges_at_the_block_price() public {
        _pricedPool(HALF_PRICE_TICK, true);
        uint fee = _quotedFee();

        signer.pay(address(router));
        require(strato.balanceOf(address(signer)) == 1e18 - fee, "charged exactly the quote");
    }

    // Pausing STRATO transfers must not switch off every paid transaction on the chain.
    function it_burns_strato_while_the_token_is_paused() public {
        _pricedPool(0, true);
        strato.pause();

        signer.pay(address(router));
        require(strato.balanceOf(address(signer)) == 1e18 - 1e16, "paid while paused");
    }

    function it_reverts_when_strato_is_short_and_there_is_no_voucher() public {
        _pricedPool(0, true);
        Signer broke = _signer();
        strato.burn(address(broke), 1e18 - 1e16 + 1); // one wei short

        require(_paymentReverts(broke), "unpaid fee fails the transaction");
        require(strato.balanceOf(address(broke)) == 1e16 - 1, "nothing burned");
    }

    function it_reverts_when_no_network_strato_is_named() public {
        Signer s = _signer();
        s.configureStrato(address(0), address(0));
        require(_paymentReverts(s), "voucher-only without STRATO");

        voucher.mint(address(s), 1e18);
        s.pay(address(router));
        require(voucher.balances(address(s)) == 0, "a voucher pays");
    }

    function it_reverts_when_the_signer_cannot_pay() public {
        _pricedPool(0, true);
        Signer broke = new Signer();
        broke.configure(address(voucher), address(usdst), address(gov), address(decider));
        broke.configureStrato(address(strato), address(0));
        require(_paymentReverts(broke), "unpaid fee fails the transaction");
    }

    // ---- staking notification ----

    function it_notifies_staking_on_the_strato_path() public {
        _pricedPool(0, true);
        gov.setStakingContract(address(staking));

        signer.pay(address(router));
        require(staking.processed() == 1, "processBlock called");
        require(strato.balanceOf(address(staking)) == 0, "no STRATO to staking");
    }

    function it_still_notifies_staking_on_the_voucher_path() public {
        gov.setStakingContract(address(staking));
        Signer voucherOnly = _signerWithVoucher();

        voucherOnly.pay(address(router));
        require(voucher.balances(address(voucherOnly)) == 0, "voucher burned");
        require(staking.processed() == 1, "processBlock still called");
    }

    function it_falls_back_when_governance_cannot_name_staking() public {
        Signer s = _signerWithVoucher();
        s.setStakingFallback(address(staking));

        s.pay(address(router));
        require(staking.processed() == 1, "processBlock via the fallback");
    }

    function it_survives_governance_without_a_staking_lookup() public {
        LegacyGovernance legacy = new LegacyGovernance();
        Signer s = _signerWithVoucher();
        s.configure(address(voucher), address(usdst), address(legacy), address(decider));
        s.setStakingFallback(address(staking));

        s.pay(address(router));
        require(staking.processed() == 1, "processBlock via the fallback");
    }

    // The pre-install state: no fallback either, so the fee is still paid and nothing
    // throws.
    function it_pays_when_nothing_can_name_staking() public {
        LegacyGovernance legacy = new LegacyGovernance();
        Signer s = _signerWithVoucher();
        s.configure(address(voucher), address(usdst), address(legacy), address(decider));

        s.pay(address(router));
        require(voucher.balances(address(s)) == 0, "voucher burned");
        require(staking.processed() == 0, "nothing to notify");
    }

    function it_prefers_governance_over_the_fallback() public {
        MockStaking named = new MockStaking();
        gov.setStakingContract(address(named));
        Signer s = _signerWithVoucher();
        s.setStakingFallback(address(staking));

        s.pay(address(router));
        require(named.processed() == 1, "governance's answer wins");
        require(staking.processed() == 0, "stale fallback not notified");
    }

    function it_swallows_process_block_failures() public {
        gov.setStakingContract(address(staking));
        staking.setRevertOnProcess(true);
        Signer s = _signerWithVoucher();

        s.pay(address(router));
        require(voucher.balances(address(s)) == 0, "fee paid although processBlock reverted");
    }

    // ---- block rewards ----

    // Point staking at a STRATO it accounts in; the router pays rewards from its
    // own balance of that token.
    function _rewarding() internal {
        _newBlock();
        staking.setStratoToken(address(strato));
        gov.setStakingContract(address(staking));
    }

    function it_routes_a_flat_block_reward_through_staking_for_the_proposer() public {
        _rewarding();
        strato.mint(address(router), 1e18);

        router.payBlockRewards();
        require(staking.rewarded(PROPOSER) == 1e16, "staking credited the proposer 0.01 STRATO");
        require(strato.balanceOf(address(staking)) == 1e16, "the reward moved into staking");
        require(strato.balanceOf(PROPOSER) == 0, "nothing paid to the node address directly");
        require(strato.balanceOf(address(router)) == 1e18 - 1e16, "paid out of the router's balance");
    }

    // The platform pays once per block on its own, but the latch has to hold too:
    // if a repeat call ever paid twice, the proposer and the verifier would derive
    // different state roots and the chain would stop committing.
    function it_pays_block_rewards_at_most_once_per_block() public {
        _rewarding();
        strato.mint(address(router), 1e18);

        router.payBlockRewards();
        router.payBlockRewards();
        router.payBlockRewards();
        require(staking.rewarded(PROPOSER) == 1e16, "repeat calls in one block pay nothing");

        fastForward(1, 1);
        router.payBlockRewards();
        require(staking.rewarded(PROPOSER) == 2e16, "the next block pays again");
    }

    // A router that has run dry must not take the chain down with it.
    function it_survives_an_unfunded_router() public {
        _rewarding();

        router.payBlockRewards();
        require(staking.rewarded(PROPOSER) == 0, "nothing paid");
        require(router.lastRewardedBlock() == block.number, "still latched, so it is not retried");
    }

    // A proposer staking will not credit (not listed, delisted) is not paid, and the
    // reward stays with the router rather than leaking anywhere.
    function it_keeps_the_reward_when_staking_declines() public {
        _rewarding();
        strato.mint(address(router), 1e18);
        staking.setRefuseRewards(true);

        router.payBlockRewards();
        require(strato.balanceOf(address(router)) == 1e18, "router keeps the reward");
        require(strato.balanceOf(address(staking)) == 0, "staking pulled nothing");
        require(router.lastRewardedBlock() == block.number, "latched");
    }

    // Rewards and pricing share one hook; a pool that cannot price must not cost the
    // proposer its reward, and a dry router must not cost the block its price.
    function it_prices_and_rewards_in_the_same_block() public {
        _rewarding();
        _pool(0, true);
        fastForward(WINDOW, 1);
        strato.mint(address(router), 1e18);

        router.payBlockRewards();
        require(_quotedFee() == 1e16, "priced");
        require(staking.rewarded(PROPOSER) == 1e16, "rewarded");
    }
}

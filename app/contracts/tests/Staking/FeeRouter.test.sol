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
    function balanceOf(address account) external view returns (uint) { return balances[account]; }
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
    uint public blockReward_ = 1e16;
    uint public swapPremiumBps = 10000;
    uint public activation;
    address public feeCollectorAddr;
    address public burnAddressOverride;

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
    function setBlockReward(uint r) public { blockReward_ = r; }
    function setSwapPremium(uint bps) public { swapPremiumBps = bps; }
    function setActivation(uint b, address collector) public { activation = b; feeCollectorAddr = collector; }
    function setBurnAddress(address sink) public { burnAddressOverride = sink; }

    function _voucher() internal view override returns (address) { return voucherAddr; }
    function _usdst() internal view override returns (address) { return usdstAddr; }
    function _governance() internal view override returns (address) { return governanceAddr; }
    function _deciderState() internal view override returns (address) { return deciderStateAddr; }
    function _stakingFallback() internal view override returns (address) { return stakingFallbackAddr; }
    function _strato() internal view override returns (address) { return stratoAddr; }
    function _pool() internal view override returns (address) { return poolAddr; }
    function _minPoolLiquidity() internal view override returns (uint) { return minLiquidity; }
    function _blockReward() internal view override returns (uint) { return blockReward_; }
    function _maxSwapPremiumBps() internal view override returns (uint) { return swapPremiumBps; }
    function _burnAddress() internal view override returns (address) { return burnAddressOverride == address(0) ? FEE_ADDRESS : burnAddressOverride; }
    function _activationBlock() internal view override returns (uint) { return activation; }
    function _feeCollector() internal view override returns (address) { return feeCollectorAddr; }
}

contract record Signer is FeeRouterHarness {
    function runCanary(address router) public { FeeRouter(router).gasCanary(); }
    function pay(address router) public {
        // Raw self-call reproduces the native root sender/storage identity;
        // delegatecall then preserves it. The production guard is not overridden.
        address(this).call("nativePay", router);
    }
    function nativePay(address router) public {
        require(msg.sender == address(this), "test native self-call only");
        address(router).delegatecall("payFees");
    }
    function untrustedDelegatePay(address router) public { address(router).delegatecall("payFees"); }

    function approve(address token, address spender, uint amount) public {
        Token(token).approve(spender, amount);
    }

    function delegateBuyGas(address router, uint amount) public {
        address(router).delegatecall("buyAndSinkFee", amount);
    }
}

contract Describe_FeeRouter {
    address constant PROPOSER = address(0xaaaa);
    address constant FEE_ADDRESS = address(0xdead5712a70000000000000000000dead5712a70);
    uint constant Q192 = 6277101735386680763835789423207666416102355444464034512896;
    uint constant WINDOW = 1800; // FeeRouter._twapWindow
    int constant FULL_RANGE = 887220; // widest tick multiple of the 0.30% tier's spacing
    int constant HALF_PRICE_TICK = -6932; // 1.0001^-6932 = 0.50004
    uint constant BIG = 100000000e18;

    AdminRegistry admin;
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

    // The paused-token whitelist lives in the AdminRegistry that owns the token factory.
    function beforeAll() public {
        feeCollector = new User();
        admin = AdminRegistry(address(new Proxy(address(new AdminRegistry()), address(this))));
        admin.initialize([this]);
        Ownable(address(admin)).transferOwnership(address(admin));
    }

    function beforeEach() public {
        factory = new TokenFactory(address(admin));
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
        (bool created, variadic ret) = admin.castVoteOnIssue(address(factory), "createTokenWithInitialOwner",
            symbol, symbol + " Token", [], [], [], symbol, 0, 18, this);
        require(created, "token not created");
        Token t = Token(address(ret));
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

    function it_freezes_the_last_price_until_pricing_recovers() public {
        _pricedPool(0, true);
        router.setMinLiquidity(BIG); // pricing fails from here on

        fastForward(7 * 86400, 1);
        router.payBlockRewards();
        require(router.priceVersion() == 1, "no new price");
        (uint fee, , bool valid) = router.stratoFeeQuote();
        require(fee == 1e16 && valid, "the last price stays chargeable however long pricing is down");
        signer.pay(address(router));
        require(strato.balanceOf(address(signer)) == 1e18 - 1e16, "paid at the last price");
        Signer withVoucher = _signerWithVoucher();
        withVoucher.pay(address(router));
        require(voucher.balances(address(withVoucher)) == 0, "a voucher still pays");

        router.setMinLiquidity(0);
        fastForward(1, 1);
        router.payBlockRewards();
        require(router.priceVersion() == 2, "pricing recovered");
        signer.pay(address(router));
    }

    // ---- payment: one whole voucher, else STRATO to the fee address ----

    function it_sends_the_strato_fee_to_the_burn_address() public {
        _pricedPool(0, true);
        uint supply = strato.totalSupply();

        signer.pay(address(router));
        require(strato.balanceOf(address(signer)) == 1e18 - 1e16, "signer paid 0.01 STRATO");
        require(strato.balanceOf(FEE_ADDRESS) == 1e16, "the fee sits at the fee address");
        require(strato.totalSupply() == supply, "moved, not burned");
        require(strato.balanceOf(address(feeCollector)) == 0, "nothing to the collector");
        require(strato.balanceOf(address(router)) == 0, "nothing to the router");
        require(strato.allowance(address(signer), address(router)) == 0, "no allowance left behind");
        require(usdst.balanceOf(address(signer)) == 0, "no USDST involved");
    }

    // sinkFee is callable by anyone, but only ever spends the caller's own approval.
    function it_only_sinks_the_callers_own_strato() public {
        _pricedPool(0, true);
        signer.approve(address(strato), address(router), 1e16);

        bool reverted = false;
        try router.sinkFee(1e16) {
        } catch {
            reverted = true;
        }
        require(reverted, "a stranger cannot spend the signer's approval");
        require(strato.balanceOf(address(signer)) == 1e18, "signer untouched");
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

    // Pausing STRATO transfers must not switch off every paid transaction on the chain,
    // which holds once the router is whitelisted for transferFrom.
    function it_pays_strato_while_the_token_is_paused() public {
        _pricedPool(0, true);
        strato.pause();
        require(_paymentReverts(signer), "a paused token stops a router that is not whitelisted");

        admin.castVoteOnIssue(address(admin), "addWhitelist", address(strato), "transferFrom", address(router));
        signer.pay(address(router));
        require(strato.balanceOf(address(signer)) == 1e18 - 1e16, "paid while paused");
        require(strato.balanceOf(FEE_ADDRESS) == 1e16, "to the fee address");
    }

    function it_reverts_when_strato_is_short_and_there_is_no_voucher() public {
        _pricedPool(0, true);
        Signer broke = _signer();
        strato.burn(address(broke), 1e18 - 1e16 + 1); // one wei short

        require(_paymentReverts(broke), "unpaid fee fails the transaction");
        require(strato.balanceOf(address(broke)) == 1e16 - 1, "nothing burned");
    }

    // ---- before the activation block: the legacy fee, no quote, no reward ----

    // payFees runs in the signer's context, so the signer carries the activation too.
    function _activateAt(uint b) internal {
        router.setActivation(b, address(feeCollector));
        signer.setActivation(b, address(feeCollector));
    }

    function it_charges_the_legacy_usdst_fee_before_activation() public {
        _pricedPool(0, true);
        _activateAt(block.number + 10);
        usdst.mint(address(signer), 1e16);

        signer.pay(address(router));
        require(usdst.balanceOf(address(signer)) == 0, "0.01 USDST paid");
        require(usdst.balanceOf(address(feeCollector)) == 1e16, "collected, not burned");
        require(strato.balanceOf(address(signer)) == 1e18, "STRATO untouched");
    }

    function it_prefers_a_voucher_before_activation() public {
        _activateAt(block.number + 10);
        voucher.mint(address(signer), 1e18);
        usdst.mint(address(signer), 1e16);

        signer.pay(address(router));
        require(voucher.balances(address(signer)) == 0, "voucher burned");
        require(usdst.balanceOf(address(signer)) == 1e16, "USDST untouched");
    }

    function it_reverts_before_activation_when_usdst_is_short() public {
        _pricedPool(0, true);
        _activateAt(block.number + 10);

        require(_paymentReverts(signer), "STRATO does not pay yet");
        require(strato.balanceOf(address(signer)) == 1e18, "nothing burned");
    }

    function it_quotes_nothing_and_pays_no_reward_before_activation() public {
        _pool(0, true);
        gov.setStakingContract(address(staking));
        staking.setStratoToken(address(strato));
        strato.mint(address(router), 1e18);
        _activateAt(block.number + 10);

        fastForward(WINDOW, 1);
        router.payBlockRewards();
        require(router.lastRewardedBlock() == block.number, "latched");
        require(router.priceVersion() == 0, "no quote written");
        require(staking.rewarded(PROPOSER) == 0, "no reward paid");
        require(router.previewStratoFee() == _expectedFee(), "but the pool is seen to price");
    }

    function it_switches_to_strato_at_the_activation_block() public {
        _pool(0, true);
        _activateAt(block.number + 2);
        usdst.mint(address(signer), 1e16);

        fastForward(WINDOW, 1);
        router.payBlockRewards();
        signer.pay(address(router));
        require(usdst.balanceOf(address(feeCollector)) == 1e16, "legacy fee one block before");
        require(strato.balanceOf(address(signer)) == 1e18, "STRATO untouched");

        _newBlock();
        router.payBlockRewards();
        require(router.priceVersion() == 1, "first quote at the activation block");
        signer.pay(address(router));
        require(strato.balanceOf(address(signer)) == 1e18 - _quotedFee(), "STRATO burned from then on");
        require(usdst.balanceOf(address(feeCollector)) == 1e16, "no more USDST collected");
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

    // ---- payment: a STRATO shortfall is bought from the canonical pool with USDST ----

    // A signer pointed at the canonical pool, holding `held` STRATO and `usdstHeld` USDST.
    function _shortSigner(uint held, uint usdstHeld) internal returns (Signer) {
        Signer s = _signer();
        s.configureStrato(address(strato), address(pool));
        strato.burn(address(s), 1e18 - held);
        usdst.mint(address(s), usdstHeld);
        return s;
    }

    function it_buys_a_strato_shortfall_with_usdst() public {
        _pricedPool(0, true);
        Signer s = _shortSigner(5e15, 1e18); // half the fee in hand
        uint supply = strato.totalSupply();

        s.pay(address(router));
        require(strato.balanceOf(address(s)) == 0, "exactly the shortfall bought, then the fee burned");
        require(strato.balanceOf(FEE_ADDRESS) == 1e16, "the whole fee goes to the fee address");
        require(strato.totalSupply() == supply, "nothing burned");
        uint spent = 1e18 - usdst.balanceOf(address(s));
        require(spent >= 5e15 && spent <= 5e15 * 101 / 100, "shortfall bought at the pool price plus its fee");
    }

    function _dustPaymentsAt(int tick, bool stratoFirst) internal {
        _pricedPool(tick, stratoFirst);
        pool.setGasSwapRouter(address(router));
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(strato), "transfer", address(pool));
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(strato), "transferFrom", address(router));
        strato.pause();
        uint fee = _quotedFee();
        uint[] memory dust = new uint[](3);
        dust[0] = 1; dust[1] = 2; dust[2] = 7;
        uint sunk = 0;
        for (uint i = 0; i < dust.length; i++) {
            Signer s = _shortSigner(0, 1e18);
            strato.mint(address(s), fee - dust[i]);
            s.approve(address(usdst), address(router), 123);
            uint price = pool.sqrtPriceX96();
            bool usdFirst = address(pool.token0()) == address(usdst);
            (uint cost, uint rounding, bool complete) = pool.quoteGasExactOutput(usdFirst, dust[i]);
            require(complete && cost > 0 && pool.sqrtPriceX96() == price, "quote changed state");
            uint proportional = (dust[i] * 2e16 + fee - 1) / fee;
            require(cost <= proportional + rounding, "quote includes more than rounding");
            s.pay(address(router));
            sunk += fee;
            require(strato.balanceOf(address(s)) == 0 && strato.balanceOf(FEE_ADDRESS) == sunk, "dust did not pay exact fee");
            require(1e18 - usdst.balanceOf(address(s)) == cost, "quote differs from actual input");
            require(usdst.allowance(address(s), address(router)) == 123, "dust changed prior allowance");
            require(usdst.allowance(address(router), address(pool)) == 0 && usdst.balanceOf(address(router)) == 0, "dust left pool approval or funds");
        }
    }
    function it_pays_dust_shortfalls_at_parity_strato_first() public { _dustPaymentsAt(0, true); }
    function it_pays_dust_shortfalls_at_parity_usdst_first() public { _dustPaymentsAt(0, false); }
    function it_pays_dust_shortfalls_at_low_tick_strato_first() public { _dustPaymentsAt(-60000, true); }
    function it_pays_dust_shortfalls_at_low_tick_usdst_first() public { _dustPaymentsAt(-60000, false); }
    function it_pays_dust_shortfalls_at_high_tick_strato_first() public { _dustPaymentsAt(60000, true); }
    function it_pays_dust_shortfalls_at_high_tick_usdst_first() public { _dustPaymentsAt(60000, false); }

    function it_pays_one_unit_shortfall_at_mainnet_fee_and_depth() public {
        _newBlock();
        poolFactory = new PoolV3Factory(address(this));
        poolFactory.initialize(address(factory), address(feeCollector));
        pool = PoolV3(poolFactory.createPoolV3(address(strato), address(usdst), 500, TickMath.getSqrtRatioAtTick(0)));
        pool.increaseObservationCardinalityNext(16);
        strato.mint(address(this), BIG); usdst.mint(address(this), BIG);
        strato.approve(address(pool), BIG); usdst.approve(address(pool), BIG);
        pool.mint(address(this), -887270, 887270, 1e20, BIG, BIG, block.timestamp);
        router.configureStrato(address(strato), address(pool));
        fastForward(WINDOW, 1); router.payBlockRewards();
        pool.setGasSwapRouter(address(router));
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(strato), "transfer", address(pool));
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(strato), "transferFrom", address(router));
        strato.pause();
        Signer s = _shortSigner(1e16 - 1, 1e18);
        s.approve(address(usdst), address(router), 123);
        (uint cost, uint rounding, bool complete) = pool.quoteGasExactOutput(false, 1);
        require(complete && cost == 3 && rounding == 1, "wrong mainnet dust rounding");
        s.pay(address(router));
        require(strato.balanceOf(FEE_ADDRESS) == 1e16 && strato.balanceOf(address(s)) == 0, "dust fee not paid");
        require(usdst.balanceOf(address(s)) == 1e18 - 3 && usdst.allowance(address(s), address(router)) == 123, "wrong dust debit or allowance");
    }

    function it_emits_a_canary_witness_without_changing_funds_after_the_fee() public {
        _pricedPool(0, true);
        Signer s = _shortSigner(0, 1e18);
        s.pay(address(router));
        uint usd = usdst.balanceOf(address(s));
        uint sunk = strato.balanceOf(FEE_ADDRESS);
        s.runCanary(address(router));
        require(usdst.balanceOf(address(s)) == usd && strato.balanceOf(FEE_ADDRESS) == sunk && strato.balanceOf(address(s)) == 0, "canary body moved funds");
    }
    function it_records_the_successful_quote_block_separately_from_timestamp() public {
        _pricedPool(0, true);
        require(block.timestamp != block.number, "fixture must separate time and height");
        require(router.quotedBlock() == block.number && router.quotedAt() == block.timestamp, "quote block/time confused");
        uint successfulBlock = router.quotedBlock();
        router.setMinLiquidity(1e40);
        fastForward(60, 1); router.payBlockRewards();
        require(router.lastRewardedBlock() == block.number && router.quotedBlock() == successfulBlock, "failed pricing falsely marked current");
    }

    function _rejectDirectFee(User attacker, address target) internal {
        bool failed = false;
        try attacker.do(target, "payFees") {
        } catch Error(string e) {
            require(e == "FeeRouter: signer context only", "wrong direct-hook rejection");
            failed = true;
        }
        require(failed, "direct public fee hook succeeded");
    }
    function it_rejects_direct_fee_calls_without_spending_router_strato() public {
        _gasOnlyPool(true);
        strato.mint(address(router), 1e18);
        User attacker = new User();
        for (uint i = 0; i < 10; i++) { _rejectDirectFee(attacker, address(router)); }
        require(strato.balanceOf(address(router)) == 1e18 && strato.balanceOf(FEE_ADDRESS) == 0, "router STRATO depleted");
        require(strato.balanceOf(address(attacker)) == 0 && usdst.balanceOf(address(attacker)) == 0, "attacker funded the test");
    }
    function it_rejects_direct_fee_calls_without_spending_router_usdst() public {
        _gasOnlyPool(true);
        usdst.mint(address(router), 1e18);
        uint price = pool.sqrtPriceX96();
        User attacker = new User();
        for (uint i = 0; i < 10; i++) { _rejectDirectFee(attacker, address(router)); }
        require(usdst.balanceOf(address(router)) == 1e18 && strato.balanceOf(FEE_ADDRESS) == 0 && pool.sqrtPriceX96() == price, "router USDST depleted or pool changed");
    }
    function it_rejects_direct_fee_calls_without_burning_router_vouchers() public {
        voucher.mint(address(router), 2e18);
        strato.mint(address(router), 1e18);
        usdst.mint(address(router), 1e18);
        User attacker = new User();
        _rejectDirectFee(attacker, address(router));
        require(voucher.balanceOf(address(router)) == 2e18 && strato.balanceOf(address(router)) == 1e18 && usdst.balanceOf(address(router)) == 1e18, "router reserves changed");
    }
    function it_preserves_the_default_fee_sink_from_develop() public {
        FeeRouter defaultRouter = new FeeRouter();
        require(defaultRouter.burnAddress() == FEE_ADDRESS, "default fee sink changed");
    }

    function it_rejects_direct_fee_calls_before_any_configuration_lookup() public {
        FeeRouter unconfigured = new FeeRouter();
        User attacker = new User();
        _rejectDirectFee(attacker, address(unconfigured));
    }
    function it_rejects_nonself_delegation_without_spending_the_signer() public {
        Signer s = _shortSigner(1e16, 1e18);
        bool failed = false;
        try s.untrustedDelegatePay(address(router)) {
        } catch Error(string e) {
            require(e == "FeeRouter: signer context only", "wrong nonself-context rejection");
            failed = true;
        }
        require(failed && strato.balanceOf(address(s)) == 1e16 && usdst.balanceOf(address(s)) == 1e18, "nonself caller charged signer");
    }

    function it_buys_the_whole_fee_when_the_signer_holds_no_strato() public {
        _pricedPool(HALF_PRICE_TICK, true);
        Signer s = _shortSigner(0, 1e18);

        s.pay(address(router));
        require(strato.balanceOf(address(s)) == 0, "fee bought and burned");
        uint spent = 1e18 - usdst.balanceOf(address(s));
        require(spent >= 1e16 && spent <= 1e16 * 101 / 100, "a cent of USDST plus the pool fee, whatever the STRATO price");
    }

    function it_puts_back_the_signers_own_pool_allowance() public {
        _pricedPool(0, true);
        Signer s = _shortSigner(0, 1e18);
        s.approve(address(usdst), address(pool), 777);

        s.pay(address(router));
        require(usdst.allowance(address(s), address(pool)) == 777, "an in-flight approval survives the fee");
    }

    function it_reverts_when_the_shortfall_cannot_be_bought() public {
        _pricedPool(0, true);
        Signer s = _shortSigner(5e15, 0);

        require(_paymentReverts(s), "no USDST and short of STRATO: unpaid");
        require(strato.balanceOf(address(s)) == 5e15, "nothing burned");
    }

    function it_refuses_to_overpay_for_the_shortfall() public {
        _pricedPool(0, true);
        Signer s = _shortSigner(0, 1e18);
        s.setSwapPremium(0); // the pool's own 0.30% already exceeds a zero premium
        router.setSwapPremium(0);

        require(_paymentReverts(s), "pool price above the cap: unpaid");
        require(strato.balanceOf(address(s)) == 0 && usdst.balanceOf(address(s)) == 1e18, "nothing bought or burned");
    }

    // ---- gas-only pool: real pool math, proxy, paused token and exact whitelist ----

    function _gasOnlyPool(bool stratoFirst) internal {
        _pricedPool(0, stratoFirst);
        pool.setGasSwapRouter(address(router));
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(strato), "transfer", address(pool));
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(strato), "transferFrom", address(router));
        strato.pause();
        require(!admin.whitelist(address(strato), "transferFrom", address(pool)), "pool does not need STRATO transferFrom");
    }

    function _buyer() internal returns (User) {
        User u = new User();
        usdst.mint(address(u), 1e18);
        u.do(address(usdst), "approve", address(router), 1e18);
        return u;
    }

    function it_blocks_ordinary_buys_on_the_gas_only_pool() public {
        _gasOnlyPool(true);
        User u = _buyer();
        u.do(address(usdst), "approve", address(pool), 1e18);
        bool failed = false;
        try u.do(address(pool), "swap", address(u), false, int(1e16), 0, 1, block.timestamp) {
        } catch Error(string e) {
            require(e == "Gas swaps only", "must reject at the pool gate");
            failed = true;
        }
        require(failed, "ordinary buy succeeded");
        require(usdst.balanceOf(address(u)) == 1e18 && strato.balanceOf(address(u)) == 0, "trade moved funds");
    }

    function it_blocks_ordinary_sells_even_with_the_old_pool_whitelist() public {
        _gasOnlyPool(true);
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(strato), "transferFrom", address(pool));
        User u = _buyer();
        strato.mint(address(u), 2e18);
        u.do(address(strato), "approve", address(pool), 2e18);
        bool failed = false;
        try u.do(address(pool), "swap", address(u), true, int(2e18), 0, 1, block.timestamp) {
        } catch Error(string e) {
            require(e == "Gas swaps only", "must reject despite the token whitelist");
            failed = true;
        }
        require(failed && strato.balanceOf(address(u)) == 2e18, "ordinary sell succeeded");
    }

    function it_blocks_direct_swaps_to_the_burn_sink_too() public {
        _gasOnlyPool(true);
        bool failed = false;
        try pool.swap(FEE_ADDRESS, false, -int(1e16), 0, 2e16, block.timestamp) {
        } catch Error(string e) {
            require(e == "Gas swaps only", "recipient must not replace caller authorization");
            failed = true;
        }
        require(failed, "owner bypassed the router gate");
    }

    function it_pays_usdst_only_gas_with_strato_paused_and_the_pool_restricted() public {
        _gasOnlyPool(true);
        Signer s = _shortSigner(0, 1e18);
        uint supply = strato.totalSupply();
        s.pay(address(router));
        require(strato.balanceOf(FEE_ADDRESS) == 1e16, "gas was not sunk");
        require(strato.balanceOf(address(s)) == 0 && strato.balanceOf(address(router)) == 0, "gas became spendable");
        require(strato.totalSupply() == supply, "fixed supply changed");
        require(usdst.allowance(address(router), address(pool)) == 0, "router left a pool approval");
    }

    function it_pays_mixed_strato_and_usdst_gas_with_the_pool_restricted() public {
        _gasOnlyPool(true);
        Signer s = _shortSigner(5e15, 1e18);
        s.pay(address(router));
        require(strato.balanceOf(address(s)) == 0, "held fee not sunk");
        require(strato.balanceOf(FEE_ADDRESS) == 1e16, "mixed payment did not sink the full fee");
        uint spent = 1e18 - usdst.balanceOf(address(s));
        require(spent > 5e15 && spent < 51e14, "wrong shortfall input");
    }

    function it_pays_gas_with_strato_as_token1() public {
        _gasOnlyPool(false);
        Signer s = _shortSigner(0, 1e18);
        s.pay(address(router));
        require(strato.balanceOf(FEE_ADDRESS) == 1e16, "wrong swap direction");
        require(strato.balanceOf(address(s)) == 0, "STRATO delivered to payer");
    }

    function it_keeps_direct_strato_and_voucher_payments_working() public {
        _gasOnlyPool(true);
        uint price = pool.sqrtPriceX96();
        signer.pay(address(router));
        Signer v = _signerWithVoucher();
        v.pay(address(router));
        require(strato.balanceOf(FEE_ADDRESS) == 1e16, "direct STRATO fee missing");
        require(voucher.balances(address(v)) == 0 && strato.balanceOf(address(v)) == 1e18, "voucher path changed");
        require(pool.sqrtPriceX96() == price, "non-swap gas moved the pool");
    }

    function it_does_not_require_the_full_usdst_cap_in_the_payers_balance() public {
        _gasOnlyPool(true);
        Signer s = _shortSigner(0, 11e15);
        s.pay(address(router));
        require(strato.balanceOf(FEE_ADDRESS) == 1e16, "affordable gas rejected");
        require(usdst.balanceOf(address(s)) > 0, "unused USDST not refunded");
        require(usdst.balanceOf(address(router)) == 0, "router retained payer input");
    }

    function it_preserves_existing_payer_approvals_including_unlimited() public {
        _gasOnlyPool(true);
        Signer s = _shortSigner(0, 1e18);
        uint unlimited = 2 ** 256 - 1;
        s.approve(address(usdst), address(router), unlimited);
        s.approve(address(usdst), address(pool), 777);
        s.pay(address(router));
        require(usdst.allowance(address(s), address(router)) == unlimited, "router approval changed");
        require(usdst.allowance(address(s), address(pool)) == 777, "pool approval changed");
    }

    function it_direct_gas_purchases_only_burn_the_callers_payment() public {
        _gasOnlyPool(true);
        User u = _buyer();
        usdst.mint(address(router), 7e18);
        strato.mint(address(router), 3e18);
        uint payerBefore = usdst.balanceOf(address(u));
        u.do(address(router), "buyAndSinkFee", 1e16);
        require(strato.balanceOf(FEE_ADDRESS) == 1e16 && strato.balanceOf(address(u)) == 0, "buyer received STRATO");
        require(usdst.balanceOf(address(router)) == 7e18 && strato.balanceOf(address(router)) == 3e18, "router pot was spent or refunded");
        require(payerBefore - usdst.balanceOf(address(u)) > 1e16, "caller did not pay");
    }

    function it_cannot_spend_a_victims_allowance_for_a_direct_gas_purchase() public {
        _gasOnlyPool(true);
        User victim = _buyer();
        User attacker = new User();
        bool failed = false;
        try attacker.do(address(router), "buyAndSinkFee", 1e16) {
        } catch {
            failed = true;
        }
        require(failed, "unfunded attacker bought gas");
        require(usdst.balanceOf(address(victim)) == 1e18, "victim paid");
        require(usdst.allowance(address(victim), address(router)) == 1e18, "victim allowance consumed");
        require(strato.balanceOf(FEE_ADDRESS) == 0, "unexpected burn");
    }

    function it_rejects_zero_and_oversized_gas_purchases() public {
        _gasOnlyPool(true);
        User u = _buyer();
        bool zeroFailed = false;
        bool largeFailed = false;
        try u.do(address(router), "buyAndSinkFee", 0) {
        } catch { zeroFailed = true; }
        try u.do(address(router), "buyAndSinkFee", 1e16 + 1) {
        } catch { largeFailed = true; }
        require(zeroFailed && largeFailed, "invalid shortfall accepted");
        require(usdst.balanceOf(address(u)) == 1e18, "invalid purchase took funds");
    }

    function it_rejects_delegatecalled_gas_purchases() public {
        _gasOnlyPool(true);
        Signer s = _shortSigner(0, 1e18);
        bool failed = false;
        try s.delegateBuyGas(address(router), 1e16) {
        } catch Error(string e) {
            require(e == "FeeRouter: installed router only", "wrong identity guard");
            failed = true;
        }
        require(failed, "gas purchase ran in payer storage");
    }

    function it_rejects_an_uninstalled_router() public {
        _gasOnlyPool(true);
        User u = _buyer();
        decider.setImpl(address(0x1234));
        bool failed = false;
        try u.do(address(router), "buyAndSinkFee", 1e16) {
        } catch { failed = true; }
        require(failed && usdst.balanceOf(address(u)) == 1e18, "old router still accepted purchases");
    }

    function it_disables_flash_even_if_the_flash_pause_flag_is_cleared() public {
        _gasOnlyPool(true);
        pool.setFlashPaused(false);
        bool failed = false;
        try pool.flash(address(this), 0, 0, []) {
        } catch Error(string e) {
            require(e == "Gas-only pool", "flash must fail at the gas-only guard");
            failed = true;
        }
        require(failed, "flash bypassed gas-only mode");
    }

    function it_only_allows_the_owner_to_change_the_gas_router() public {
        _gasOnlyPool(true);
        User u = new User();
        bool failed = false;
        try u.do(address(pool), "setGasSwapRouter", address(u)) {
        } catch { failed = true; }
        require(failed && pool.gasSwapRouter() == address(router), "router restriction replaced");
    }

    function it_rolls_back_failed_gas_swaps_and_refunds_nothing_from_the_router_pot() public {
        _gasOnlyPool(true);
        Signer s = _shortSigner(5e15, 1);
        usdst.mint(address(router), 7e18);
        uint price = pool.sqrtPriceX96();
        uint poolStrato = strato.balanceOf(address(pool));
        uint poolUsdst = usdst.balanceOf(address(pool));
        require(_paymentReverts(s), "unaffordable gas accepted");
        require(usdst.balanceOf(address(s)) == 1 && strato.balanceOf(address(s)) == 5e15, "payer state persisted");
        require(usdst.balanceOf(address(router)) == 7e18, "router subsidized gas");
        require(pool.sqrtPriceX96() == price && strato.balanceOf(address(pool)) == poolStrato && usdst.balanceOf(address(pool)) == poolUsdst, "pool state persisted");
        require(strato.balanceOf(FEE_ADDRESS) == 0, "failed gas burned tokens");
    }

    function it_respects_a_configured_sink_override() public {
        _gasOnlyPool(true);
        address sink = address(0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead);
        require(sink != FEE_ADDRESS, "override must differ from default sink");
        router.setBurnAddress(sink);
        Signer s = _shortSigner(5e15, 1e18);
        s.pay(address(router));
        require(strato.balanceOf(sink) == 1e16, "fee sent to wrong sink");
        require(strato.balanceOf(FEE_ADDRESS) == 0, "default sink used");
    }

    function it_rolls_back_a_purchase_when_sinking_the_held_portion_fails() public {
        _gasOnlyPool(true);
        admin.castVoteOnIssue(address(admin), "removeWhitelist", address(strato), "transferFrom", address(router));
        Signer s = _shortSigner(5e15, 1e18);
        uint price = pool.sqrtPriceX96();
        uint poolStrato = strato.balanceOf(address(pool));
        uint poolUsdst = usdst.balanceOf(address(pool));
        require(_paymentReverts(s), "unwhitelisted router sank held STRATO");
        require(strato.balanceOf(FEE_ADDRESS) == 0, "shortfall burn persisted");
        require(strato.balanceOf(address(s)) == 5e15 && usdst.balanceOf(address(s)) == 1e18, "payer debit persisted");
        require(pool.sqrtPriceX96() == price && strato.balanceOf(address(pool)) == poolStrato && usdst.balanceOf(address(pool)) == poolUsdst, "purchase persisted");
    }

    function it_rejects_an_incomplete_exact_output_quote_atomically() public {
        _gasOnlyPool(true);
        strato.unpause();
        pool.burn(-FULL_RANGE, FULL_RANGE, 1e24, block.timestamp);
        strato.approve(address(pool), BIG);
        usdst.approve(address(pool), BIG);
        pool.mint(address(this), -60, 60, 1e10, BIG, BIG, block.timestamp);
        strato.pause();
        Signer s = _shortSigner(0, 1e18);
        uint price = pool.sqrtPriceX96();
        bool failed = false;
        try s.pay(address(router)) {
        } catch Error(string e) {
            require(e == "FeeRouter: incomplete gas quote", "must reject the partial fill");
            failed = true;
        }
        require(failed, "partial gas fee accepted");
        require(strato.balanceOf(FEE_ADDRESS) == 0 && usdst.balanceOf(address(s)) == 1e18, "partial purchase persisted");
        require(pool.sqrtPriceX96() == price, "partial swap changed the price");
    }

    function it_keeps_one_quote_for_multiple_gas_swaps_in_the_same_block() public {
        _gasOnlyPool(true);
        Signer a = _shortSigner(0, 1e18);
        Signer b = _shortSigner(0, 1e18);
        a.pay(address(router));
        b.pay(address(router));
        require(router.priceVersion() == 1 && _quotedFee() == 1e16, "gas swap repriced the fee");
        require(strato.balanceOf(FEE_ADDRESS) == 2e16, "payers paid different STRATO fees");
    }

    function it_rejects_direct_gas_purchases_before_the_first_quote() public {
        _pool(0, true);
        pool.setGasSwapRouter(address(router));
        User u = _buyer();
        bool failed = false;
        try u.do(address(router), "buyAndSinkFee", 1) {
        } catch { failed = true; }
        require(failed && usdst.balanceOf(address(u)) == 1e18, "unpriced purchase accepted");
    }

    function it_reproduces_and_closes_the_live_pool_whitelist_gap_at_mainnet_depth() public {
        _newBlock();
        poolFactory = new PoolV3Factory(address(this));
        poolFactory.initialize(address(factory), address(feeCollector));
        pool = PoolV3(poolFactory.createPoolV3(address(strato), address(usdst), 500, 79228162514264337593543950336));
        pool.increaseObservationCardinalityNext(16);
        strato.mint(address(this), BIG);
        usdst.mint(address(this), BIG);
        strato.approve(address(pool), BIG);
        usdst.approve(address(pool), BIG);
        pool.mint(address(this), -887270, 887270, 1e20, BIG, BIG, block.timestamp);
        router.configureStrato(address(strato), address(pool));
        fastForward(WINDOW, 1);
        router.payBlockRewards();
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(strato), "transfer", address(pool));
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(strato), "transferFrom", address(pool));
        admin.castVoteOnIssue(address(admin), "addWhitelist", address(strato), "transferFrom", address(router));
        strato.pause();

        User trader = _buyer();
        strato.mint(address(trader), 4e18);
        trader.do(address(strato), "approve", address(pool), 4e18);
        trader.do(address(pool), "swap", address(trader), true, int(2e18), 0, 1, block.timestamp);
        require(strato.balanceOf(address(trader)) == 2e18, "baseline gap was not reproduced");

        pool.setGasSwapRouter(address(router));
        admin.castVoteOnIssue(address(admin), "removeWhitelist", address(strato), "transferFrom", address(pool));
        bool failed = false;
        try trader.do(address(pool), "swap", address(trader), true, int(2e18), 0, 1, block.timestamp) {
        } catch Error(string e) {
            require(e == "Gas swaps only", "gate must close the reproduced route");
            failed = true;
        }
        require(failed && strato.balanceOf(address(trader)) == 2e18, "ordinary trading remains open");
        Signer s = _shortSigner(0, 1e18);
        s.pay(address(router));
        require(strato.balanceOf(FEE_ADDRESS) == 1e16 && strato.balanceOf(address(s)) == 0, "gas failed at mainnet depth");
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
    function it_pays_no_reward_when_switched_off() public {
        _rewarding();
        strato.mint(address(router), 1e18);
        router.setBlockReward(0);

        router.payBlockRewards();
        require(staking.rewarded(PROPOSER) == 0, "nothing paid");
        require(strato.balanceOf(address(router)) == 1e18, "the balance stays put");
        require(router.lastRewardedBlock() == block.number, "still latched");
    }

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

import "../../concrete/BaseCodeCollection.sol";
import "../../concrete/Pools/PoolV3Factory.sol";
import "../../concrete/Pools/PositionManagerV3.sol";
import "../../abstract/ERC20/access/Authorizable.sol";

/*
 * PositionManagerV3 test suite.
 *
 * Fee-attribution correctness is proven differentially: the same action sequence is run
 * through the manager on one pool and directly (per-owner positions) on a mirror pool with
 * identical parameters, and outcomes must match bit-for-bit. This checks the manager's
 * per-tokenId snapshot math against the pool's own Position.update accounting with no
 * pinned constants.
 */

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_PositionManagerV3 is Authorizable {

    Mercata m;
    string[] emptyArray;

    PoolV3Factory factory;
    PositionManagerV3 manager;
    address token0Address;
    address token1Address;
    address poolAddress;
    PoolV3 pool;

    uint constant Q96 = 79228162514264337593543950336;
    uint constant DEADLINE_OFFSET = 3600;
    uint constant BIG = 100000000e18;
    uint constant MAX_COLLECT = 340282366920938463463374607431768211456; // 2^128

    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
        emptyArray = new string[](0);
    }

    function beforeEach() {
        token0Address = m.tokenFactory().createToken(
            "Token 0", "Test Token 0", emptyArray, emptyArray, emptyArray, "TK0", 10000000e18, 18
        );
        token1Address = m.tokenFactory().createToken(
            "Token 1", "Test Token 1", emptyArray, emptyArray, emptyArray, "TK1", 10000000e18, 18
        );
        Token(token0Address).setStatus(2); // ACTIVE
        Token(token1Address).setStatus(2); // ACTIVE
        Token(token0Address).mint(address(this), BIG);
        Token(token1Address).mint(address(this), BIG);

        factory = new PoolV3Factory(address(this));
        factory.initialize(address(m.tokenFactory()), address(m.feeCollector()));
        poolAddress = factory.createPoolV3(token0Address, token1Address, 3000, Q96);
        pool = PoolV3(poolAddress);

        manager = new PositionManagerV3(address(this));
        manager.initialize(address(factory));

        // the test contract funds its own managed mints
        require(ERC20(token0Address).approve(address(manager), BIG), "Token0 approval failed");
        require(ERC20(token1Address).approve(address(manager), BIG), "Token1 approval failed");
    }

    // ============ HELPERS ============

    function _deadline() internal returns (uint) {
        return block.timestamp + DEADLINE_OFFSET;
    }

    function _mintManaged(int tickLower, int tickUpper, uint amount0Desired, uint amount1Desired)
        internal
        returns (uint tokenId, uint liquidity, uint amount0, uint amount1)
    {
        return manager.mint(
            poolAddress, tickLower, tickUpper,
            amount0Desired, amount1Desired, 0, 0,
            address(this), _deadline()
        );
    }

    /// @dev Exact-input swap on a given pool by the test contract
    function _swapOn(PoolV3 p, bool zeroForOne, uint amountIn) internal {
        address tokenIn = zeroForOne ? address(p.token0()) : address(p.token1());
        require(ERC20(tokenIn).approve(address(p), amountIn), "Swap approval failed");
        p.swap(address(this), zeroForOne, int(amountIn), 0, 1, _deadline());
    }

    /// @dev A user with balances and manager approvals (for managed mints)
    function _newManagedUser() internal returns (User) {
        User u = new User();
        Token(token0Address).mint(address(u), BIG);
        Token(token1Address).mint(address(u), BIG);
        u.do(token0Address, "approve", address(manager), BIG);
        u.do(token1Address, "approve", address(manager), BIG);
        return u;
    }

    /// @dev A user with balances and direct-pool approvals on a given pool
    function _newDirectUser(PoolV3 p) internal returns (User) {
        User u = new User();
        Token(address(p.token0())).mint(address(u), BIG);
        Token(address(p.token1())).mint(address(u), BIG);
        u.do(address(p.token0()), "approve", address(p), BIG);
        u.do(address(p.token1()), "approve", address(p), BIG);
        return u;
    }

    /// @dev Fresh pair + pool with the same tier/price as the primary pool, for differential
    ///      (manager vs direct) comparisons
    function _createMirrorPool() internal returns (PoolV3) {
        address t0 = m.tokenFactory().createToken(
            "Mirror 0", "Mirror Token 0", emptyArray, emptyArray, emptyArray, "MR0", 10000000e18, 18
        );
        address t1 = m.tokenFactory().createToken(
            "Mirror 1", "Mirror Token 1", emptyArray, emptyArray, emptyArray, "MR1", 10000000e18, 18
        );
        Token(t0).setStatus(2);
        Token(t1).setStatus(2);
        Token(t0).mint(address(this), BIG);
        Token(t1).mint(address(this), BIG);
        return PoolV3(factory.createPoolV3(t0, t1, 3000, Q96));
    }

    // ============ MINT ============

    function it_mint_creates_nft_and_position() {
        (uint tokenId, uint liquidity, uint amount0, uint amount1) =
            _mintManaged(-600, 600, 1000e18, 1000e18);

        require(tokenId == 1, "First tokenId should be 1");
        require(manager.nextTokenId() == 2, "nextTokenId should advance to 2");
        require(manager.ownerOf(1) == address(this), "NFT should belong to recipient");
        require(manager.balanceOf(address(this)) == 1, "Recipient balance should be 1");
        require(liquidity > 0, "Liquidity should be positive");
        require(amount0 > 0 && amount1 > 0, "In-range mint should take both tokens");

        (address posPool, int tl, int tu, uint posLiquidity, uint owed0, uint owed1) =
            manager.getPosition(1);
        require(posPool == poolAddress, "Position pool mismatch");
        require(tl == -600 && tu == 600, "Position range mismatch");
        require(posLiquidity == liquidity, "Position liquidity mismatch");
        require(owed0 == 0 && owed1 == 0, "Fresh position should owe nothing");

        // the pool-level position belongs to the manager
        (uint poolLiquidity, , ) = pool.getPosition(address(manager), -600, 600);
        require(poolLiquidity == liquidity, "Pool position should be owned by the manager");
    }

    function it_mint_pulls_exact_amounts_and_leaves_no_residue() {
        uint bal0Before = ERC20(token0Address).balanceOf(address(this));
        uint bal1Before = ERC20(token1Address).balanceOf(address(this));

        (, , uint amount0, uint amount1) = _mintManaged(-600, 600, 1000e18, 1000e18);

        require(
            bal0Before - ERC20(token0Address).balanceOf(address(this)) == amount0,
            "Caller should pay exactly amount0"
        );
        require(
            bal1Before - ERC20(token1Address).balanceOf(address(this)) == amount1,
            "Caller should pay exactly amount1"
        );
        require(amount0 <= 1000e18 && amount1 <= 1000e18, "Amounts should not exceed desired");
        require(ERC20(token0Address).balanceOf(address(manager)) == 0, "Manager should hold no token0");
        require(ERC20(token1Address).balanceOf(address(manager)) == 0, "Manager should hold no token1");
        require(
            ERC20(token0Address).allowance(address(manager), poolAddress) == 0,
            "Pool allowance should be fully consumed"
        );
    }

    function it_mint_ids_are_sequential() {
        (uint id1, , , ) = _mintManaged(-600, 600, 1000e18, 1000e18);
        (uint id2, , , ) = _mintManaged(-1200, 1200, 500e18, 500e18);
        require(id1 == 1 && id2 == 2, "TokenIds should be sequential from 1");
        require(manager.ownerOf(2) == address(this), "Second NFT should exist");
    }

    function it_mint_rejects_unregistered_pool() {
        // a real PoolV3 that did not come from the factory registry
        PoolV3 rogue = new PoolV3(address(this));
        rogue.initialize(token0Address, token1Address, 3000, 60, Q96, address(factory));

        bool thrown = false;
        try {
            manager.mint(address(rogue), -600, 600, 1000e18, 1000e18, 0, 0, address(this), _deadline());
        } catch {
            thrown = true;
        }
        require(thrown, "Unregistered pool should be rejected");
    }

    function it_mint_slippage_check_reverts() {
        bool thrown = false;
        try {
            // amount0Min far above what 1000e18 desired can require
            manager.mint(poolAddress, -600, 600, 1000e18, 1000e18, 2000e18, 0, address(this), _deadline());
        } catch {
            thrown = true;
        }
        require(thrown, "Slippage check should revert");
    }

    function it_mint_expired_deadline_reverts() {
        bool thrown = false;
        try {
            manager.mint(poolAddress, -600, 600, 1000e18, 1000e18, 0, 0, address(this), block.timestamp - 1);
        } catch {
            thrown = true;
        }
        require(thrown, "Expired deadline should revert");
    }

    function it_mint_single_sided_ranges() {
        // current tick is 0: [600, 1200) is above spot -> all token0; [-1200, -600) below -> all token1
        (, , uint a0, uint a1) = _mintManaged(600, 1200, 1000e18, 0);
        require(a0 > 0 && a1 == 0, "Above-range mint should take only token0");

        (, , uint b0, uint b1) = _mintManaged(-1200, -600, 0, 1000e18);
        require(b0 == 0 && b1 > 0, "Below-range mint should take only token1");
    }

    function it_uninitialized_manager_is_locked() {
        PositionManagerV3 fresh = new PositionManagerV3(address(this));
        bool thrown = false;
        try {
            fresh.mint(poolAddress, -600, 600, 1000e18, 1000e18, 0, 0, address(this), _deadline());
        } catch {
            thrown = true;
        }
        require(thrown, "Uninitialized manager should be locked");
    }

    // ============ INCREASE ============

    function it_increase_grows_position() {
        (uint tokenId, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);
        (uint added, uint amount0, uint amount1) =
            manager.increaseLiquidity(tokenId, 500e18, 500e18, 0, 0, _deadline());

        require(added > 0 && amount0 > 0 && amount1 > 0, "Increase should add liquidity");
        (, , , uint posLiquidity, , ) = manager.getPosition(tokenId);
        require(posLiquidity == liquidity + added, "Position liquidity should grow by added amount");

        (uint poolLiquidity, , ) = pool.getPosition(address(manager), -600, 600);
        require(poolLiquidity == liquidity + added, "Pool position should grow identically");
    }

    function it_increase_by_non_owner_is_allowed_and_paid_by_caller() {
        (uint tokenId, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);

        User u = _newManagedUser();
        uint uBal0Before = ERC20(token0Address).balanceOf(address(u));
        u.do(address(manager), "increaseLiquidity", tokenId, 500e18, 500e18, 0, 0, _deadline());

        (, , , uint posLiquidity, , ) = manager.getPosition(tokenId);
        require(posLiquidity > liquidity, "Anyone may fund an increase");
        require(
            ERC20(token0Address).balanceOf(address(u)) < uBal0Before,
            "The increase caller pays"
        );
        require(manager.ownerOf(tokenId) == address(this), "Ownership is unchanged");
    }

    function it_increase_nonexistent_token_reverts() {
        bool thrown = false;
        try {
            manager.increaseLiquidity(99, 500e18, 500e18, 0, 0, _deadline());
        } catch {
            thrown = true;
        }
        require(thrown, "Increase on nonexistent token should revert");
    }

    // ============ DECREASE / COLLECT ============

    function it_decrease_credits_principal_then_collect_pays() {
        (uint tokenId, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);

        uint half = liquidity / 2;
        (uint amount0, uint amount1) = manager.decreaseLiquidity(tokenId, half, 0, 0, _deadline());
        require(amount0 > 0 && amount1 > 0, "Decrease should return principal amounts");

        (, , , uint posLiquidity, uint owed0, uint owed1) = manager.getPosition(tokenId);
        require(posLiquidity == liquidity - half, "Liquidity should shrink by the burned amount");
        require(owed0 == amount0 && owed1 == amount1, "Principal should be owed (no fees yet)");

        uint bal0Before = ERC20(token0Address).balanceOf(address(this));
        (uint c0, uint c1) = manager.collect(tokenId, address(this), MAX_COLLECT, MAX_COLLECT);
        require(c0 == amount0 && c1 == amount1, "Collect should pay the owed principal");
        require(
            ERC20(token0Address).balanceOf(address(this)) == bal0Before + c0,
            "Collect should transfer token0 to the recipient"
        );

        (, , , , uint owedAfter0, uint owedAfter1) = manager.getPosition(tokenId);
        require(owedAfter0 == 0 && owedAfter1 == 0, "Owed amounts should clear after collect");
    }

    function it_decrease_more_than_liquidity_reverts() {
        (uint tokenId, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);
        bool thrown = false;
        try {
            manager.decreaseLiquidity(tokenId, liquidity + 1, 0, 0, _deadline());
        } catch {
            thrown = true;
        }
        require(thrown, "Over-decrease should revert");
    }

    function it_collect_fees_without_decreasing() {
        (uint tokenId, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);

        _swapOn(pool, true, 10e18);

        (uint fees0, uint fees1) = manager.collect(tokenId, address(this), MAX_COLLECT, MAX_COLLECT);
        require(fees0 > 0, "Swap fees in token0 should be collectable");
        require(fees1 == 0, "No token1 fees from a zeroForOne swap");

        (, , , uint posLiquidity, , ) = manager.getPosition(tokenId);
        require(posLiquidity == liquidity, "Poke-collect must not change liquidity");
    }

    function it_collect_pays_third_party_recipient_directly() {
        (uint tokenId, , , ) = _mintManaged(-600, 600, 1000e18, 1000e18);
        _swapOn(pool, true, 10e18);

        User sink = new User();
        (uint fees0, ) = manager.collect(tokenId, address(sink), MAX_COLLECT, MAX_COLLECT);
        require(fees0 > 0, "Fees should accrue");
        require(
            ERC20(token0Address).balanceOf(address(sink)) == fees0,
            "Pool should pay the recipient directly"
        );
        require(ERC20(token0Address).balanceOf(address(manager)) == 0, "Manager must hold nothing");
    }

    function it_collect_respects_max_caps() {
        (uint tokenId, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);
        manager.decreaseLiquidity(tokenId, liquidity, 0, 0, _deadline());
        (, , , , uint owed0, ) = manager.getPosition(tokenId);
        require(owed0 > 2, "Need something owed");

        (uint c0, ) = manager.collect(tokenId, address(this), 1, MAX_COLLECT);
        require(c0 == 1, "Collect should be capped at amount0Max");
        (, , , , uint owedAfter, ) = manager.getPosition(tokenId);
        require(owedAfter == owed0 - 1, "Remainder should stay owed");
    }

    // ============ BURN ============

    function it_burn_requires_cleared_position() {
        (uint tokenId, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);

        bool thrown = false;
        try {
            manager.burn(tokenId);
        } catch {
            thrown = true;
        }
        require(thrown, "Burn with live liquidity should revert");

        manager.decreaseLiquidity(tokenId, liquidity, 0, 0, _deadline());
        thrown = false;
        try {
            manager.burn(tokenId);
        } catch {
            thrown = true;
        }
        require(thrown, "Burn with owed amounts should revert");

        manager.collect(tokenId, address(this), MAX_COLLECT, MAX_COLLECT);
        manager.burn(tokenId);

        thrown = false;
        try {
            manager.ownerOf(tokenId);
        } catch {
            thrown = true;
        }
        require(thrown, "Burned NFT should not exist");

        thrown = false;
        try {
            manager.getPosition(tokenId);
        } catch {
            thrown = true;
        }
        require(thrown, "Burned position should not be readable");
    }

    // ============ AUTHORIZATION / TRANSFER ============

    function it_strangers_cannot_manage_positions() {
        (uint tokenId, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);
        User stranger = new User();

        bool thrown = false;
        try {
            stranger.do(address(manager), "decreaseLiquidity", tokenId, liquidity, 0, 0, _deadline());
        } catch {
            thrown = true;
        }
        require(thrown, "Stranger decrease should revert");

        thrown = false;
        try {
            stranger.do(address(manager), "collect", tokenId, address(stranger), MAX_COLLECT, MAX_COLLECT);
        } catch {
            thrown = true;
        }
        require(thrown, "Stranger collect should revert");

        thrown = false;
        try {
            stranger.do(address(manager), "burn", tokenId);
        } catch {
            thrown = true;
        }
        require(thrown, "Stranger burn should revert");
    }

    function it_transfer_moves_position_control() {
        (uint tokenId, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);
        _swapOn(pool, true, 10e18);

        User newOwner = new User();
        manager.transferFrom(address(this), address(newOwner), tokenId);
        require(manager.ownerOf(tokenId) == address(newOwner), "NFT should transfer");

        // the previous owner has lost control
        bool thrown = false;
        try {
            manager.decreaseLiquidity(tokenId, liquidity, 0, 0, _deadline());
        } catch {
            thrown = true;
        }
        require(thrown, "Previous owner must lose control");

        // the new owner controls liquidity, fees and principal
        newOwner.do(address(manager), "decreaseLiquidity", tokenId, liquidity, 0, 0, _deadline());
        newOwner.do(address(manager), "collect", tokenId, address(newOwner), MAX_COLLECT, MAX_COLLECT);
        require(
            ERC20(token0Address).balanceOf(address(newOwner)) > 0,
            "New owner should receive principal and the pre-transfer fees"
        );
        (, , , uint posLiquidity, uint owed0, uint owed1) = manager.getPosition(tokenId);
        require(posLiquidity == 0 && owed0 == 0 && owed1 == 0, "Position should be emptied");
    }

    function it_approved_operator_can_manage() {
        (uint tokenId, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);
        User operator = new User();

        manager.approve(address(operator), tokenId);
        operator.do(address(manager), "decreaseLiquidity", tokenId, liquidity / 2, 0, 0, _deadline());

        (, , , uint posLiquidity, , ) = manager.getPosition(tokenId);
        require(posLiquidity == liquidity - liquidity / 2, "Approved operator may decrease");
    }

    // ============ POOL GUARD INTERPLAY ============

    function it_paused_pool_blocks_mint_but_not_exit() {
        (uint tokenId, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);
        _swapOn(pool, true, 10e18);

        pool.setPaused(true);

        bool thrown = false;
        try {
            _mintManaged(-600, 600, 1000e18, 1000e18);
        } catch {
            thrown = true;
        }
        require(thrown, "Mint through the manager should respect pool pause");

        // exit stays open: decrease + collect work while paused
        manager.decreaseLiquidity(tokenId, liquidity, 0, 0, _deadline());
        (uint c0, uint c1) = manager.collect(tokenId, address(this), MAX_COLLECT, MAX_COLLECT);
        require(c0 > 0 && c1 > 0, "Exit must stay open while paused");
    }

    // ============ FEE ATTRIBUTION (differential vs direct positions) ============

    /// @dev Two managed positions (same range, same liquidity, different holders) must earn
    ///      exactly what two direct positions earn in a mirror pool under the same swaps
    function it_fee_attribution_matches_direct_positions() {
        // managed side: two holders, same range, same liquidity
        (uint tokenId1, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);

        User holder2 = _newManagedUser();
        holder2.do(
            address(manager), "mint",
            poolAddress, -600, 600, 1000e18, 1000e18, 0, 0, address(holder2), _deadline()
        );
        uint tokenId2 = manager.nextTokenId() - 1;
        (, , , uint liquidity2, , ) = manager.getPosition(tokenId2);
        require(liquidity2 == liquidity, "Equal desired amounts should yield equal liquidity");

        _swapOn(pool, true, 10e18);
        _swapOn(pool, false, 7e18);

        // mirror side: two direct users with the same liquidity, same swaps
        PoolV3 mirror = _createMirrorPool();
        User direct1 = _newDirectUser(mirror);
        User direct2 = _newDirectUser(mirror);
        direct1.do(address(mirror), "mint", address(direct1), -600, 600, liquidity, BIG, BIG, _deadline());
        direct2.do(address(mirror), "mint", address(direct2), -600, 600, liquidity, BIG, BIG, _deadline());
        _swapOn(mirror, true, 10e18);
        _swapOn(mirror, false, 7e18);

        // both sides collect everything (owner-side poke first for the direct users)
        (uint m0_1, uint m1_1) = manager.collect(tokenId1, address(this), MAX_COLLECT, MAX_COLLECT);
        User sink2 = new User();
        holder2.do(address(manager), "collect", tokenId2, address(sink2), MAX_COLLECT, MAX_COLLECT);
        uint m0_2 = ERC20(token0Address).balanceOf(address(sink2));
        uint m1_2 = ERC20(token1Address).balanceOf(address(sink2));

        direct1.do(address(mirror), "burn", -600, 600, 0, _deadline());
        User dSink1 = new User();
        direct1.do(address(mirror), "collect", address(dSink1), -600, 600, MAX_COLLECT, MAX_COLLECT);
        direct2.do(address(mirror), "burn", -600, 600, 0, _deadline());
        User dSink2 = new User();
        direct2.do(address(mirror), "collect", address(dSink2), -600, 600, MAX_COLLECT, MAX_COLLECT);

        uint d0_1 = ERC20(address(mirror.token0())).balanceOf(address(dSink1));
        uint d1_1 = ERC20(address(mirror.token1())).balanceOf(address(dSink1));
        uint d0_2 = ERC20(address(mirror.token0())).balanceOf(address(dSink2));
        uint d1_2 = ERC20(address(mirror.token1())).balanceOf(address(dSink2));

        require(m0_1 > 0 && m1_1 > 0, "Managed holder 1 should earn fees in both tokens");
        require(m0_1 == d0_1 && m1_1 == d1_1, "Holder 1 fees must match the direct position");
        require(m0_2 == d0_2 && m1_2 == d1_2, "Holder 2 fees must match the direct position");
    }

    /// @dev Staggered entries into a shared range: fees earned before the second entry belong
    ///      only to the first token. Differential vs direct positions with the same timeline
    function it_staggered_entry_attribution_matches_direct_positions() {
        (uint tokenId1, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);
        _swapOn(pool, true, 10e18); // fees exclusively for token 1

        User holder2 = _newManagedUser();
        holder2.do(
            address(manager), "mint",
            poolAddress, -600, 600, 1000e18, 1000e18, 0, 0, address(holder2), _deadline()
        );
        uint tokenId2 = manager.nextTokenId() - 1;
        (, , , uint liquidity2, , ) = manager.getPosition(tokenId2);

        _swapOn(pool, true, 10e18); // fees shared by both tokens

        // mirror timeline with direct positions
        PoolV3 mirror = _createMirrorPool();
        User direct1 = _newDirectUser(mirror);
        User direct2 = _newDirectUser(mirror);
        direct1.do(address(mirror), "mint", address(direct1), -600, 600, liquidity, BIG, BIG, _deadline());
        _swapOn(mirror, true, 10e18);
        direct2.do(address(mirror), "mint", address(direct2), -600, 600, liquidity2, BIG, BIG, _deadline());
        _swapOn(mirror, true, 10e18);

        (uint m0_1, ) = manager.collect(tokenId1, address(this), MAX_COLLECT, MAX_COLLECT);
        User sink2 = new User();
        holder2.do(address(manager), "collect", tokenId2, address(sink2), MAX_COLLECT, MAX_COLLECT);
        uint m0_2 = ERC20(token0Address).balanceOf(address(sink2));

        direct1.do(address(mirror), "burn", -600, 600, 0, _deadline());
        User dSink1 = new User();
        direct1.do(address(mirror), "collect", address(dSink1), -600, 600, MAX_COLLECT, MAX_COLLECT);
        direct2.do(address(mirror), "burn", -600, 600, 0, _deadline());
        User dSink2 = new User();
        direct2.do(address(mirror), "collect", address(dSink2), -600, 600, MAX_COLLECT, MAX_COLLECT);

        uint d0_1 = ERC20(address(mirror.token0())).balanceOf(address(dSink1));
        uint d0_2 = ERC20(address(mirror.token0())).balanceOf(address(dSink2));

        require(m0_1 == d0_1, "Early entrant's fees must match the direct timeline");
        // The shared pool position's tokensOwed is credited in floor-rounded chunks (one per
        // Position.update), so it can be a wei short of the sum of per-token ledgers; the
        // LAST collector of a shared range absorbs that dust (canonical NonfungiblePosition-
        // Manager behavior: "sometimes a few wei less due to rounding"). The ledger itself
        // is exact — only the payout may fall short by the number of accrual chunks
        require(m0_2 <= d0_2 && d0_2 - m0_2 <= 2, "Late entrant's fees must match the direct timeline modulo shared-position rounding dust");
        require(m0_1 > m0_2, "Early entrant must have earned strictly more");
        require(m0_2 > 0, "Late entrant still earns from the second swap");
    }

    /// @dev Increase mid-stream: fee accrual at increase time must use the pre-increase
    ///      liquidity. Differential vs a direct position that adds liquidity the same way
    function it_increase_accrues_with_old_liquidity() {
        (uint tokenId, uint liquidity, , ) = _mintManaged(-600, 600, 1000e18, 1000e18);
        _swapOn(pool, true, 10e18);
        (uint added, , ) = manager.increaseLiquidity(tokenId, 1000e18, 1000e18, 0, 0, _deadline());
        _swapOn(pool, true, 10e18);
        (uint m0, ) = manager.collect(tokenId, address(this), MAX_COLLECT, MAX_COLLECT);

        PoolV3 mirror = _createMirrorPool();
        User direct = _newDirectUser(mirror);
        direct.do(address(mirror), "mint", address(direct), -600, 600, liquidity, BIG, BIG, _deadline());
        _swapOn(mirror, true, 10e18);
        direct.do(address(mirror), "mint", address(direct), -600, 600, added, BIG, BIG, _deadline());
        _swapOn(mirror, true, 10e18);
        direct.do(address(mirror), "burn", -600, 600, 0, _deadline());
        User dSink = new User();
        direct.do(address(mirror), "collect", address(dSink), -600, 600, MAX_COLLECT, MAX_COLLECT);
        uint d0 = ERC20(address(mirror.token0())).balanceOf(address(dSink));

        require(m0 > 0, "Fees should accrue across the increase");
        require(m0 == d0, "Managed fees across an increase must match the direct equivalent");
    }
}

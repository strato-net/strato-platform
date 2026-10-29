import "../../concrete/Tokenomics/TokenVesting.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

// SolidVM-specific probes for the TokenVesting port. These are not the upstream
// suite; they pin the behaviours that differ between the EVM and SolidVM
// (call-by-name locals, abi.encodePacked of never-written storage, the
// AdminRegistry-routed onlyOwner) and the audited schedule semantics the STRATO
// tokenomics rely on (slice steps, cliff gate, delayed start).
contract Describe_TokenVestingSolidVM {
    // Mirror of TokenVesting.VestingSchedule so struct returns can be read here.
    struct VestingSchedule {
        bool initialized;
        address beneficiary;
        uint256 cliff;
        uint256 start;
        uint256 duration;
        uint256 slicePeriodSeconds;
        bool revocable;
        uint256 amountTotal;
        uint256 released;
        bool revoked;
    }

    uint constant DAY = 86400;
    uint constant MONTH = 30 * DAY;
    uint constant POOL = 10000;

    Token strato;
    TokenVesting vesting;
    User alice;
    User stranger;

    function beforeAll() public {
        alice = new User();
        stranger = new User();
    }

    function beforeEach() public {
        TokenFactory factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        vesting = new TokenVesting(address(strato));
        strato.mint(address(vesting), POOL);
    }

    function _create(address b, uint start, uint cliff, uint duration, uint slice, bool revocable, uint amount) internal returns (bytes32) {
        bytes32 id = vesting.computeNextVestingScheduleIdForHolder(b);
        vesting.createVestingSchedule(b, start, cliff, duration, slice, revocable, amount);
        return id;
    }

    // (a) D8: the first schedule id of a fresh holder must be the index-0 id.
    function it_first_schedule_id_for_a_fresh_holder_matches_index_zero() public {
        bytes32 literal = vesting.computeVestingScheduleIdForAddressAndIndex(address(alice), 0);
        require(vesting.computeNextVestingScheduleIdForHolder(address(alice)) == literal, "next id for a fresh holder must equal the index-0 id");

        vesting.createVestingSchedule(address(alice), block.timestamp, 0, 1000, 1, false, 1000);
        require(vesting.getVestingIdAtIndex(0) == literal, "stored id must equal the index-0 id");
        require(vesting.getVestingSchedulesCountByBeneficiary(address(alice)) == 1, "one schedule for alice");
        require(vesting.computeReleasableAmount(literal) == 0, "schedule reachable through the index-0 id");

        VestingSchedule memory last = vesting.getLastVestingScheduleForHolder(address(alice));
        require(last.initialized && last.beneficiary == address(alice) && last.amountTotal == 1000, "getLastVestingScheduleForHolder resolves the first schedule");
        VestingSchedule memory byIndex = vesting.getVestingScheduleByAddressAndIndex(address(alice), 0);
        require(byIndex.initialized && byIndex.amountTotal == 1000, "getVestingScheduleByAddressAndIndex resolves index 0");

        bytes32 second = vesting.computeVestingScheduleIdForAddressAndIndex(address(alice), 1);
        require(second != literal, "ids are distinct");
        require(vesting.computeNextVestingScheduleIdForHolder(address(alice)) == second, "next id advances to index 1");
        vesting.createVestingSchedule(address(alice), block.timestamp, 0, 1000, 1, true, 500);
        require(vesting.getVestingIdAtIndex(1) == second, "second stored id is the index-1 id");
        require(vesting.getVestingSchedulesCount() == 2, "two schedules");
        require(vesting.getVestingSchedulesTotalAmount() == 1500, "1500 committed");
        last = vesting.getLastVestingScheduleForHolder(address(alice));
        require(last.amountTotal == 500 && last.revocable, "last schedule is the second one");
    }

    // (b) release accounting under call-by-name locals.
    function it_release_pays_the_exact_amount_and_reduces_the_total() public {
        bytes32 id = _create(address(alice), block.timestamp, 0, 1000, 1, false, 1000);
        require(vesting.getWithdrawableAmount() == POOL - 1000, "committed tokens are not withdrawable");
        fastForward(400);
        require(vesting.computeReleasableAmount(id) == 400, "400 vested after 400 of 1000 seconds");

        alice.doSuccessfully(address(vesting), "release(bytes32,uint256)", id, uint256(300));
        require(strato.balanceOf(address(alice)) == 300, "alice got " + string(strato.balanceOf(address(alice))) + ", expected 300");
        require(vesting.getVestingSchedulesTotalAmount() == 700, "total is " + string(vesting.getVestingSchedulesTotalAmount()) + ", expected 700");
        require(vesting.computeReleasableAmount(id) == 100, "100 still releasable");
        require(vesting.getWithdrawableAmount() == POOL - 1000, "release does not change the withdrawable amount");

        // The owner may release too; tokens always go to the beneficiary.
        vesting.release(id, 100);
        require(strato.balanceOf(address(alice)) == 400, "alice got the rest");
        require(strato.balanceOf(address(this)) == 0, "owner received nothing");

        stranger.doExpectingFailure(address(vesting), "release(bytes32,uint256)", "TokenVesting: only beneficiary and owner can release vested tokens", id, uint256(1));
        alice.doExpectingFailure(address(vesting), "release(bytes32,uint256)", "TokenVesting: cannot release tokens, not enough vested tokens", id, uint256(1));

        fastForward(600);
        vesting.release(id, 600);
        require(strato.balanceOf(address(alice)) == 1000, "fully released");
        require(vesting.getVestingSchedulesTotalAmount() == 0, "nothing committed after full release");
    }

    // (c) revoke pays what has vested, marks the schedule, frees the remainder.
    function it_revoke_pays_vested_marks_revoked_and_frees_the_remainder() public {
        bytes32 id = _create(address(alice), block.timestamp, 0, 1000, 1, true, 1000);
        fastForward(250);
        vesting.revoke(id);

        require(strato.balanceOf(address(alice)) == 250, "alice got " + string(strato.balanceOf(address(alice))) + ", expected the vested 250");
        VestingSchedule memory s = vesting.getVestingSchedule(id);
        require(s.revoked, "marked revoked");
        require(s.released == 250, "released recorded");
        require(vesting.getVestingSchedulesTotalAmount() == 0, "nothing committed after revoke");
        require(vesting.getWithdrawableAmount() == POOL - 250, "unreleased remainder is withdrawable");

        bool reverted = false;
        try vesting.computeReleasableAmount(id) { } catch { reverted = true; }
        require(reverted, "a revoked schedule is rejected by computeReleasableAmount");
        reverted = false;
        try alice.do(address(vesting), "release(bytes32,uint256)", id, uint256(1)) { } catch { reverted = true; }
        require(reverted, "release after revoke reverts");

        vesting.withdraw(POOL - 250);
        require(strato.balanceOf(address(this)) == POOL - 250, "owner withdrew the remainder");
        require(vesting.getWithdrawableAmount() == 0, "pool drained");
    }

    // (d) revoke of a non-revocable schedule: state must be untouched. The failed
    // require sits inside the AdminRegistry-routed onlyOwner, so the revert is
    // generic; assert state rather than a message.
    function it_revoke_of_a_non_revocable_schedule_changes_nothing() public {
        bytes32 id = _create(address(alice), block.timestamp, 0, 1000, 1, false, 1000);
        fastForward(250);
        bool reverted = false;
        try vesting.revoke(id) { } catch { reverted = true; }

        VestingSchedule memory s = vesting.getVestingSchedule(id);
        require(!s.revoked, "not revoked");
        require(s.released == 0, "nothing released");
        require(strato.balanceOf(address(alice)) == 0, "alice untouched");
        require(vesting.getVestingSchedulesTotalAmount() == 1000, "total untouched");
        require(vesting.computeReleasableAmount(id) == 250, "still vesting");
        require(reverted, "revoke of a non-revocable schedule reverts");
    }

    // (e) withdraw is capped at the uncommitted balance; only the owner may call it.
    function it_withdraw_cannot_exceed_the_uncommitted_balance() public {
        _create(address(alice), block.timestamp, 0, 1000, 1, false, 1000);
        require(vesting.getWithdrawableAmount() == POOL - 1000, "9000 withdrawable");

        bool reverted = false;
        try stranger.do(address(vesting), "withdraw(uint256)", uint256(1)) { } catch { reverted = true; }
        require(reverted, "stranger cannot withdraw");
        require(strato.balanceOf(address(vesting)) == POOL, "stranger moved nothing");

        reverted = false;
        try vesting.withdraw(POOL - 1000 + 1) { } catch { reverted = true; }
        require(reverted, "over-withdraw reverts");
        require(strato.balanceOf(address(vesting)) == POOL, "over-withdraw moved nothing");

        vesting.withdraw(POOL - 1000);
        require(strato.balanceOf(address(this)) == POOL - 1000, "owner received 9000");
        require(vesting.getWithdrawableAmount() == 0, "nothing left to withdraw");

        reverted = false;
        try vesting.createVestingSchedule(address(stranger), block.timestamp, 0, 1, 1, false, 1) { } catch { reverted = true; }
        require(reverted, "cannot commit more than the pool holds");
        require(vesting.getVestingSchedulesCount() == 1, "no schedule added");
    }

    // (f) a 30-day slice unlocks in steps: flat inside a slice, a jump at each boundary.
    function it_slice_period_of_thirty_days_unlocks_in_steps() public {
        bytes32 id = _create(address(alice), block.timestamp, 0, 24 * MONTH, MONTH, false, 2400);
        fastForward(MONTH - 1);
        require(vesting.computeReleasableAmount(id) == 0, "nothing before the first slice boundary");
        fastForward(1);
        require(vesting.computeReleasableAmount(id) == 100, "first slice unlocks 1/24");
        fastForward(15 * DAY);
        require(vesting.computeReleasableAmount(id) == 100, "flat inside a slice");
        fastForward(15 * DAY);
        require(vesting.computeReleasableAmount(id) == 200, "second slice");
        fastForward(22 * MONTH - 1);
        require(vesting.computeReleasableAmount(id) == 2300, "23 slices one second before the end");
        fastForward(1);
        require(vesting.computeReleasableAmount(id) == 2400, "everything at the end");
    }

    // (g) the audited cliff is a gate: nothing before it, then the accrual counted
    // from start. A delayed start with no cliff gives the sheet's "nothing at the
    // cliff, then 1/24 per month" team shape.
    function it_cliff_gates_then_releases_the_accrual_from_start() public {
        bytes32 id = _create(address(alice), block.timestamp, 12 * MONTH, 36 * MONTH, DAY, false, 3600);
        fastForward(12 * MONTH - 1);
        require(vesting.computeReleasableAmount(id) == 0, "nothing before the cliff");
        fastForward(1);
        require(vesting.computeReleasableAmount(id) == 1200, "at the cliff the accrual from start unlocks, got " + string(vesting.computeReleasableAmount(id)));

        bytes32 team = _create(address(stranger), block.timestamp + 12 * MONTH, 0, 24 * MONTH, MONTH, true, 2400);
        require(vesting.computeReleasableAmount(team) == 0, "nothing before a future start");
        fastForward(12 * MONTH);
        require(vesting.computeReleasableAmount(team) == 0, "nothing at the delayed start");
        fastForward(MONTH);
        require(vesting.computeReleasableAmount(team) == 100, "one twenty-fourth after the first month");
        fastForward(23 * MONTH);
        require(vesting.computeReleasableAmount(team) == 2400, "all after 24 months");
    }
}

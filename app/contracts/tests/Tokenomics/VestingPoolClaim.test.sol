import "../../concrete/Tokenomics/VestingPool.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../Util.sol";

// Port of safe-token test/vesting/VestingPool.Claim.spec.ts (main 886fc7b0).
// Adaptations: the public `vestings(id)` getter returns empty values on this CLI, so the
// pool under test is InspectablePool, a subclass that only adds field readers (logic is the
// inherited upstream code); ClaimedVesting/Transfer events become balance checks; upstream's
// MockContract becomes the MockToken below; setNextBlockTime becomes fastForward; where
// upstream relies on Hardhat advancing one second per transaction (vested > half after a
// second claim) the test advances one second explicitly.
contract InspectablePool is VestingPool {
    constructor(address t, address m) VestingPool(t, m) {}
    function vestingAmount(bytes32 id) external view returns (uint128) { return vestings[id].amount; }
    function vestingAmountClaimed(bytes32 id) external view returns (uint128) { return vestings[id].amountClaimed; }
}

// Stand-in for upstream's MockContract: balanceOf is scripted, transfer can succeed, return false or revert.
contract MockToken {
    uint256 public mode; // 0 = succeed, 1 = return false, 2 = revert
    uint256 bal;
    function setBalance(uint256 b) external { bal = b; }
    function setMode(uint256 m) external { mode = m; }
    function balanceOf(address) external view returns (uint256) { return bal; }
    function transfer(address, uint256) external returns (bool) {
        if (mode == 1) return false;
        if (mode == 2) revert("Token: Transfer failed!");
        return true;
    }
}

contract Describe_VestingPoolClaim {
    uint constant WEEK = 604800;
    uint128 constant MAX_UINT128 = 340282366920938463463374607431768211455;
    Token strato;
    User user2;
    InspectablePool pool;

    function beforeAll() public {
        user2 = new User();
    }

    function beforeEach() public {
        TokenFactory factory = new TokenFactory(address(this));
        strato = Token(factory.createTokenWithInitialOwner("STRATO", "STRATO Token", new string[](0), new string[](0), new string[](0), "STRATO", 0, 18, address(this)));
        strato.setStatus(2);
        pool = new InspectablePool(address(strato), address(this));
    }

    function _units(uint n) internal pure returns (uint128) {
        return uint128(n * 10**18);
    }

    function _now() internal view returns (uint64) {
        return uint64(block.timestamp);
    }

    function _warpTo(uint ts) internal {
        require(ts > block.timestamp, "warp target " + string(ts) + " is not after now " + string(block.timestamp));
        fastForward(ts - block.timestamp);
    }

    // upstream helper: vesting for user1 (this contract), linear, 2 weeks
    function _addVesting(uint128 amount, uint64 startTime, bool managed) internal returns (bytes32) {
        strato.mint(address(pool), amount);
        bytes32 vestingHash = pool.vestingHash(address(this), 0, managed, 2, startTime, amount);
        pool.addVesting(address(this), 0, managed, 2, startTime, amount);
        return vestingHash;
    }

    function _checkAmounts(bytes32 vestingHash, uint128 expectedVested, uint128 expectedClaimed, string context) internal {
        (uint128 vestedAmount, uint128 claimedAmount) = pool.calculateVestedAmount(vestingHash);
        require(vestedAmount == expectedVested, context + ": vested " + string(vestedAmount) + " expected " + string(expectedVested));
        require(claimedAmount == expectedClaimed, context + ": claimed " + string(claimedAmount) + " expected " + string(expectedClaimed));
    }

    function it_should_revert_if_not_vesting_owner() public {
        bytes32 vestingHash = keccak256(abi.encodePacked("test"));
        user2.doExpectingFailure(address(pool), "claimVestedTokens", "Can only be claimed by vesting owner", vestingHash, address(this), MAX_UINT128);
    }

    function it_should_revert_if_beneficiary_is_0_address() public {
        bytes32 vestingHash = keccak256(abi.encodePacked("test"));
        bool reverted = false;
        try pool.claimVestedTokens(vestingHash, address(0), MAX_UINT128) { } catch Error(string e) { reverted = true; require(e == "Cannot claim to 0-address", e); }
        require(reverted, "claim to zero address succeeded");
    }

    function it_should_revert_if_claiming_too_many_tokens() public {
        uint128 vestingAmount = _units(1000);
        uint64 currentTime = _now();
        uint64 targetTime = currentTime + 3600;
        bytes32 vestingHash = _addVesting(vestingAmount, targetTime, true);
        _warpTo(uint256(currentTime) + 7200);
        bool reverted = false;
        try pool.claimVestedTokens(vestingHash, address(this), vestingAmount) { } catch Error(string e) { reverted = true; require(e == "Trying to claim too many tokens", e); }
        require(reverted, "over-claim succeeded");
    }

    function it_should_revert_if_token_transfer_fails() public {
        MockToken mock = new MockToken();
        VestingPool mockPool = new VestingPool(address(mock), address(this));
        uint128 vestingAmount = _units(1000);
        mock.setBalance(vestingAmount);
        uint64 targetTime = _now() + 3600;
        bytes32 vestingHash = mockPool.vestingHash(address(this), 0, true, 2, targetTime, vestingAmount);
        mockPool.addVesting(address(this), 0, true, 2, targetTime, vestingAmount);
        mock.setMode(1);
        _warpTo(uint256(targetTime) + 7200);
        bool reverted = false;
        try mockPool.claimVestedTokens(vestingHash, address(this), MAX_UINT128) { } catch Error(string e) { reverted = true; require(e == "Token transfer failed", e); }
        require(reverted, "claim succeeded although transfer returned false");
    }

    function it_should_revert_if_token_transfer_reverts() public {
        MockToken mock = new MockToken();
        VestingPool mockPool = new VestingPool(address(mock), address(this));
        uint128 vestingAmount = _units(1000);
        mock.setBalance(vestingAmount);
        uint64 targetTime = _now() + 3600;
        bytes32 vestingHash = mockPool.vestingHash(address(this), 0, true, 2, targetTime, vestingAmount);
        mockPool.addVesting(address(this), 0, true, 2, targetTime, vestingAmount);
        mock.setMode(2);
        _warpTo(uint256(targetTime) + 7200);
        bool reverted = false;
        // SolidVM: a revert raised by the token (two calls deep) reaches this frame as a raw
        // REVERT carrying "Token: Transfer failed!" rather than as Error(string), so the
        // message branch never fires on the 2026-03 CLI and the generic catch records the
        // revert. Upstream asserts revertedWith("Token: Transfer failed!"); the message is
        // asserted here whenever the VM delivers it as Error(string).
        try mockPool.claimVestedTokens(vestingHash, address(this), MAX_UINT128) { }
        catch Error(string e) { reverted = true; require(e == "Token: Transfer failed!", e); }
        catch { reverted = true; }
        require(reverted, "claim succeeded although transfer reverted");
        require(mockPool.totalTokensInVesting() == vestingAmount, "nothing was claimed");
    }

    function it_should_revert_if_vesting_is_not_active_yet() public {
        uint128 vestingAmount = _units(1000);
        uint64 targetTime = _now() + 3600;
        bytes32 vestingHash = _addVesting(vestingAmount, targetTime, true);
        bool reverted = false;
        try pool.claimVestedTokens(vestingHash, address(this), MAX_UINT128) { } catch Error(string e) { reverted = true; require(e == "Vesting not active yet", e); }
        require(reverted, "claim before start succeeded");
    }

    function it_can_claim_available_tokens_while_vesting_is_running() public {
        uint128 vestingAmount = _units(1000);
        uint64 targetTime = _now() + 3600;
        bytes32 vestingHash = _addVesting(vestingAmount, targetTime, true);
        require(pool.vestingAmount(vestingHash) == vestingAmount, "amount");
        require(pool.vestingAmountClaimed(vestingHash) == 0, "nothing claimed yet");

        _warpTo(uint256(targetTime) + WEEK);
        uint128 claimAmount = vestingAmount / 2;
        pool.claimVestedTokens(vestingHash, address(this), claimAmount);
        require(strato.balanceOf(address(this)) == claimAmount, "claimer received " + string(strato.balanceOf(address(this))));
        require(strato.balanceOf(address(pool)) == vestingAmount - claimAmount, "pool balance");
        require(pool.vestingAmount(vestingHash) == vestingAmount, "amount unchanged");
        require(pool.vestingAmountClaimed(vestingHash) == claimAmount, "claimed recorded");
        _checkAmounts(vestingHash, claimAmount, claimAmount, "after half claim");
    }

    function it_can_claim_all_tokens_after_vesting_is_completed() public {
        uint128 vestingAmount = _units(1000);
        uint64 targetTime = _now() + 3600;
        bytes32 vestingHash = _addVesting(vestingAmount, targetTime, true);
        require(pool.vestingAmount(vestingHash) == vestingAmount, "amount");
        require(pool.vestingAmountClaimed(vestingHash) == 0, "nothing claimed yet");

        _warpTo(uint256(targetTime) + 3 * WEEK);
        pool.claimVestedTokens(vestingHash, address(this), MAX_UINT128);
        require(strato.balanceOf(address(this)) == vestingAmount, "claimer received everything");
        require(pool.vestingAmount(vestingHash) == vestingAmount, "amount unchanged");
        require(pool.vestingAmountClaimed(vestingHash) == vestingAmount, "all claimed");
        _checkAmounts(vestingHash, vestingAmount, vestingAmount, "after full claim");
    }

    function it_can_claim_available_tokens_to_different_account() public {
        uint128 vestingAmount = _units(1000);
        uint64 targetTime = _now() + 3600;
        bytes32 vestingHash = _addVesting(vestingAmount, targetTime, true);
        require(pool.vestingAmount(vestingHash) == vestingAmount, "amount");
        require(pool.vestingAmountClaimed(vestingHash) == 0, "nothing claimed yet");

        _warpTo(uint256(targetTime) + WEEK);
        uint128 claimAmount = vestingAmount / 2;
        pool.claimVestedTokens(vestingHash, address(user2), claimAmount);
        require(strato.balanceOf(address(user2)) == claimAmount, "beneficiary received " + string(strato.balanceOf(address(user2))));
        require(strato.balanceOf(address(this)) == 0, "claimer must not receive");
        require(pool.vestingAmount(vestingHash) == vestingAmount, "amount unchanged");
        require(pool.vestingAmountClaimed(vestingHash) == claimAmount, "claimed recorded");
        _checkAmounts(vestingHash, claimAmount, claimAmount, "after claim to other account");
    }

    function it_can_claim_tokens_when_vesting_is_paused() public {
        uint128 vestingAmount = _units(1000);
        uint64 targetTime = _now() + 3600;
        bytes32 vestingHash = _addVesting(vestingAmount, targetTime, true);
        require(pool.vestingAmount(vestingHash) == vestingAmount, "amount");
        require(pool.vestingAmountClaimed(vestingHash) == 0, "nothing claimed yet");

        // Pause vesting after half of the amount is vested
        _warpTo(uint256(targetTime) + WEEK);
        pool.pauseVesting(vestingHash);
        _checkAmounts(vestingHash, vestingAmount / 2, 0, "paused at half");

        // Claim available tokens
        _warpTo(uint256(targetTime) + 2 * WEEK);
        pool.claimVestedTokens(vestingHash, address(this), MAX_UINT128);
        require(strato.balanceOf(address(this)) == vestingAmount / 2, "first claim paid half");

        // Check that no additional tokens have been vested
        _checkAmounts(vestingHash, vestingAmount / 2, vestingAmount / 2, "after claim while paused");

        // Unpause the vesting after 2 weeks have elapsed
        _warpTo(uint256(targetTime) + 3 * WEEK);
        pool.unpauseVesting(vestingHash);
        // Check that no additional tokens have been vested during pause
        _checkAmounts(vestingHash, vestingAmount / 2, vestingAmount / 2, "right after unpause");

        // Claim all tokens after vesting has been completed
        _warpTo(uint256(targetTime) + 4 * WEEK);
        pool.claimVestedTokens(vestingHash, address(this), MAX_UINT128);
        require(strato.balanceOf(address(this)) == vestingAmount, "second claim paid the rest");
        _checkAmounts(vestingHash, vestingAmount, vestingAmount, "completed");
    }

    function it_can_claim_available_tokens_multiple_times_to_different_accounts() public {
        uint128 vestingAmount = _units(1000);
        uint64 targetTime = _now() + 3600;
        bytes32 vestingHash = _addVesting(vestingAmount, targetTime, true);
        require(pool.vestingAmount(vestingHash) == vestingAmount, "amount");
        require(pool.vestingAmountClaimed(vestingHash) == 0, "nothing claimed yet");

        _warpTo(uint256(targetTime) + WEEK);
        uint128 claimAmount = vestingAmount / 4;
        pool.claimVestedTokens(vestingHash, address(this), claimAmount);
        require(strato.balanceOf(address(this)) == claimAmount, "first claim");
        _checkAmounts(vestingHash, vestingAmount / 2, claimAmount, "after first claim");

        // Hardhat mines a block per transaction; emulate the one-second advance upstream relies on
        fastForward(1);
        pool.claimVestedTokens(vestingHash, address(this), claimAmount);
        require(strato.balanceOf(address(this)) == claimAmount * 2, "second claim");
        (uint128 vestedAfterSecond, uint128 claimedAfterSecond) = pool.calculateVestedAmount(vestingHash);
        require(vestedAfterSecond > vestingAmount / 2, "vested should have grown past half");
        require(claimedAfterSecond == claimAmount * 2, "claimed after second");

        _warpTo(uint256(targetTime) + 2 * WEEK);
        pool.claimVestedTokens(vestingHash, address(user2), claimAmount);
        require(strato.balanceOf(address(user2)) == claimAmount, "third claim to user2");
        _checkAmounts(vestingHash, vestingAmount, claimAmount * 3, "after third claim");

        pool.claimVestedTokens(vestingHash, address(this), claimAmount);
        require(strato.balanceOf(address(this)) == claimAmount * 3, "fourth claim");
        _checkAmounts(vestingHash, vestingAmount, vestingAmount, "fully claimed");
    }
}

// SPDX-License-Identifier: MIT
// Adapted from OpenZeppelin Contracts v5.6.1 (finance/VestingWallet.sol) for SolidVM:
//  - The beneficiary is fixed at construction. OpenZeppelin's wallet is Ownable, so
//    the beneficiary could transfer (sell) or renounce the unvested tokens; here
//    nothing can.
//  - ERC-20 only. The native-currency functions are dropped: STRATO has no native
//    asset to vest, and SolidVM dispatches an external call to an overloaded
//    function by name, so release() and release(token) cannot coexist.
//  - SafeERC20.safeTransfer becomes a checked transfer.

import "../../abstract/ERC20/IERC20.sol";

/**
 * @dev A vesting wallet can receive ERC-20 tokens and release them to its
 * beneficiary according to a vesting schedule.
 *
 * Any assets transferred to this contract will follow the vesting schedule as if they were locked from the beginning.
 * Consequently, if the vesting has already started, any amount of tokens sent to this contract will (at least partly)
 * be immediately releasable.
 *
 * By setting the duration to 0, one can configure this contract to behave like an asset timelock that holds tokens for
 * a beneficiary until a specified time.
 *
 * NOTE: When using this contract with any token whose balance is adjusted automatically (i.e. a rebase token), make
 * sure to account the supply/balance adjustment in the vesting schedule to ensure the vested amount is as intended.
 */
contract VestingWallet {
    event ERC20Released(address indexed token, uint256 amount);

    mapping(address token => uint256) private _erc20Released;
    address private immutable _beneficiary;
    uint64 private immutable _start;
    uint64 private immutable _duration;

    /**
     * @dev Sets the beneficiary, the start timestamp and the vesting duration (in seconds) of the vesting wallet.
     */
    constructor(address beneficiaryAddress, uint64 startTimestamp, uint64 durationSeconds) {
        require(beneficiaryAddress != address(0), "VestingWallet: beneficiary is zero");
        _beneficiary = beneficiaryAddress;
        _start = startTimestamp;
        _duration = durationSeconds;
    }

    /**
     * @dev Getter for the beneficiary address.
     */
    function beneficiary() public view virtual returns (address) {
        return _beneficiary;
    }

    /**
     * @dev Getter for the start timestamp.
     */
    function start() public view virtual returns (uint256) {
        return _start;
    }

    /**
     * @dev Getter for the vesting duration.
     */
    function duration() public view virtual returns (uint256) {
        return _duration;
    }

    /**
     * @dev Getter for the end timestamp.
     */
    function end() public view virtual returns (uint256) {
        return start() + duration();
    }

    /**
     * @dev Amount of token already released
     */
    function released(address token) public view virtual returns (uint256) {
        return _erc20Released[token];
    }

    /**
     * @dev Getter for the amount of releasable `token` tokens. `token` should be the address of an
     * {IERC20} contract.
     */
    function releasable(address token) public view virtual returns (uint256) {
        return vestedAmount(token, uint64(block.timestamp)) - released(token);
    }

    /**
     * @dev Release the tokens that have already vested.
     *
     * Emits a {ERC20Released} event.
     */
    function release(address token) public virtual {
        uint256 amount = releasable(token);
        _erc20Released[token] += amount;
        emit ERC20Released(token, amount);
        require(IERC20(token).transfer(beneficiary(), amount), "VestingWallet: transfer failed");
    }

    /**
     * @dev Calculates the amount of tokens that has already vested. Default implementation is a linear vesting curve.
     */
    function vestedAmount(address token, uint64 timestamp) public view virtual returns (uint256) {
        return _vestingSchedule(IERC20(token).balanceOf(address(this)) + released(token), timestamp);
    }

    /**
     * @dev Virtual implementation of the vesting formula. This returns the amount vested, as a function of time, for
     * an asset given its total historical allocation.
     */
    function _vestingSchedule(uint256 totalAllocation, uint64 timestamp) internal view virtual returns (uint256) {
        if (timestamp < start()) {
            return 0;
        } else if (timestamp >= end()) {
            return totalAllocation;
        } else {
            return (totalAllocation * (timestamp - start())) / duration();
        }
    }
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (utils/Pausable.sol)

// pragma solidity ^0.8.20;

import {Context} from "../utils/Context.sol";

/**
 * @dev Contract module which allows children to implement an emergency stop
 * mechanism that can be triggered by an authorized account.
 *
 * This module is used through inheritance. It will make available the
 * modifiers `whenNotPaused` and `whenPaused`, which can be applied to
 * the functions of your contract. Note that they will not be pausable by
 * simply including this module, only once the modifiers are put in place.
 *
 * MODIFICATIONS FROM ORIGINAL OPENZEPPELIN CONTRACT:
 * 1. Added allow list functionality: `_allowList` mapping and `_allowedAddresses` array
 * 2. Added `_pause'(address[] allowList)` function for pausing with specific allowed addresses
 * 3. Modified `_pause()` to delegate to `_pause'()` with empty allow list (backward compatible)
 * 4. Modified `paused()` function to return false for addresses on the allow list
 * 5. Modified `_unpause()` to clear the allow list when unpausing
 *
 * The allow list enables selective pausing: when paused with an allow list,
 * only addresses NOT on the allow list are paused. Addresses on the allow list
 * can continue to operate normally even when the contract is in a paused state.
 */
abstract contract Pausable is Context {
    bool private _paused;
    mapping(address => bool) private _allowList;
    address[] private _allowedAddresses;

    /**
     * @dev Emitted when the pause is triggered by `account`.
     */
    event Paused(address account);

    /**
     * @dev Emitted when the pause is lifted by `account`.
     */
    event Unpaused(address account);

    /**
     * @dev The operation failed because the contract is paused.
     */
    error EnforcedPause();

    /**
     * @dev The operation failed because the contract is not paused.
     */
    error ExpectedPause();

    /**
     * @dev Modifier to make a function callable only when the contract is not paused.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    modifier whenNotPaused() {
        _requireNotPaused();
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is paused.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    modifier whenPaused() {
        _requirePaused();
        _;
    }

    /**
     * @dev Returns true if the contract is paused, and false otherwise.
     */
    function paused() public view virtual returns (bool) {
        // If the caller is on the allow list, they are never paused
        if (_allowList[_msgSender()]) {
            return false;
        }
        return _paused;
    }

    /**
     * @dev Throws if the contract is paused.
     */
    function _requireNotPaused() internal view virtual {
        if (paused()) {
            revert EnforcedPause();
        }
    }

    /**
     * @dev Throws if the contract is not paused.
     */
    function _requirePaused() internal view virtual {
        if (!paused()) {
            revert ExpectedPause();
        }
    }

    /**
     * @dev Triggers stopped state.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function _pause() internal virtual whenNotPaused {
        address[] memory emptyList;
        _pause'(emptyList);
    }

    /**
     * @dev Triggers stopped state with allow list.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function _pause'(address[] allowList) internal virtual whenNotPaused {
        _paused = true;
        for (uint256 i = 0; i < allowList.length; i++) {
            _allowList[allowList[i]] = true;
            _allowedAddresses.push(allowList[i]);
        }
        emit Paused(_msgSender());
    }

    /**
     * @dev Returns to normal state.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    function _unpause() internal virtual whenPaused {
        _paused = false;
        // Clear the allow list
        for (uint256 i = 0; i < _allowedAddresses.length; i++) {
            _allowList[_allowedAddresses[i]] = false;
        }
        delete _allowedAddresses;
        emit Unpaused(_msgSender());
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Reentrancy guard mixin (transient storage variant).
/// @author Solady (https://github.com/vectorized/solady/blob/main/src/utils/ReentrancyGuardTransient.sol)
///
/// @dev Note: This implementation utilizes the `TSTORE` and `TLOAD` opcodes.
/// Please ensure that the chain you are deploying on supports them.
abstract contract ReentrancyGuardTransient {
    /// @dev Unauthorized reentrant call.
    error Reentrancy();

    bool private _entered;

    /// @dev Guards a function from reentrancy.
    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    /// @dev Guards a view function from read-only reentrancy.
    modifier nonReadReentrant() {
        if (_entered) revert Reentrancy();
        _;
    }
}

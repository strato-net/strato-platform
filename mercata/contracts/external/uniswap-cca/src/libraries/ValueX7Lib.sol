// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ConstantsLib} from './ConstantsLib.sol';

/// @title ValueX7Lib
library ValueX7Lib {
    /// @notice The scaling factor for ValueX7 values (ConstantsLib.MPS)
    uint256 public constant X7 = ConstantsLib.MPS;

    /// @notice Subtract two X7-scaled values, returning zero on underflow.
    function saturatingSub(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a > b) return a - b;
        return 0;
    }

    /// @notice Divide an X7-scaled value by a uint256.
    function divUint256(uint256 valueX7, uint256 divisor) internal pure returns (uint256) {
        return valueX7 / divisor;
    }

    /// @notice Multiply a uint256 value by MPS
    /// @dev This ensures that future operations will not lose precision
    /// @return The result as an X7-scaled uint256
    function scaleUpToX7(uint256 value) internal pure returns (uint256) {
        return value * X7;
    }

    /// @notice Divide an X7-scaled value by MPS
    /// @return The result as a uint256
    function scaleDownToUint256(uint256 valueX7) internal pure returns (uint256) {
        return valueX7 / X7;
    }
}

// SPDX-License-Identifier: MIT

/// @title FixedPoint96
/// @notice The Q64.96 fixed-point unit, as in Uniswap V3 core's FixedPoint96
library FixedPoint96 {
    uint internal constant RESOLUTION = 96;
    uint internal constant Q96 = 0x1000000000000000000000000; // 2**96
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {IERC20Minimal} from '../interfaces/external/IERC20Minimal.sol';
import {IERC20} from '../../../../abstract/ERC20/IERC20.sol';

/// @title CurrencyLibrary
/// @dev This library allows for transferring and holding native tokens and ERC20 tokens
/// @dev Forked from https://github.com/Uniswap/v4-core/blob/main/src/types/Currency.sol but modified to not bubble up reverts
library CurrencyLibrary {
    /// @notice Thrown when a native transfer fails
    error NativeTransferFailed();

    /// @notice Thrown when an ERC20 transfer fails
    error ERC20TransferFailed();

    /// @notice A constant to represent the native currency
    address public constant ADDRESS_ZERO = address(0);

    function transfer(address currency, address to, uint256 amount) internal {
        if (isAddressZero(currency)) {
            revert NativeTransferFailed();
        } else {
            if (!IERC20(currency).transfer(to, amount)) {
                revert ERC20TransferFailed();
            }
        }
    }

    function balanceOf(address currency, address owner) internal view returns (uint256) {
        if (isAddressZero(currency)) {
            owner;
            return 0;
        } else {
            return IERC20(currency).balanceOf(owner);
        }
    }

    function isAddressZero(address currency) internal pure returns (bool) {
        return currency == ADDRESS_ZERO;
    }
}

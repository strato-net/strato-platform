// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ITokenFactory} from "@uniswap/uerc20-factory/src/interfaces/ITokenFactory.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Deploys a MockERC20 and mints the initial supply to the recipient.
/// The `data` and `graffiti` args are accepted but ignored beyond being
/// echoed in the emitted event for test assertions.
contract MockTokenFactory is ITokenFactory {
    event TokenMinted(address indexed token, address indexed recipient, uint256 amount, bytes32 graffiti);

    function createToken(
        string calldata _name,
        string calldata _symbol,
        uint8 _decimals,
        uint256 initialSupply,
        address recipient,
        bytes calldata /* data */,
        bytes32 graffiti
    ) external override returns (address tokenAddress) {
        if (recipient == address(0)) revert RecipientCannotBeZeroAddress();
        if (initialSupply == 0) revert TotalSupplyCannotBeZero();

        MockERC20 token = new MockERC20(_name, _symbol, _decimals);
        token.mint(recipient, initialSupply);
        tokenAddress = address(token);

        emit TokenCreated(tokenAddress);
        emit TokenMinted(tokenAddress, recipient, initialSupply, graffiti);
    }
}

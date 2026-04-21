// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice A lean IAllowanceTransfer stub: stores approvals, and on
/// transferFrom pulls ERC20 tokens from the owner using the normal
/// ERC20 allowance the owner granted this Permit2 mock directly. Methods
/// not exercised in the test suite (lockdown, invalidateNonces, batch
/// transferFrom) are accepted but no-op.
contract MockPermit2 is IAllowanceTransfer {
    mapping(address => mapping(address => mapping(address => PackedAllowance))) private _allowance;

    function DOMAIN_SEPARATOR() external pure override returns (bytes32) {
        return bytes32(0);
    }

    function allowance(address user, address token, address spender)
        external
        view
        override
        returns (uint160 amount, uint48 expiration, uint48 nonce)
    {
        PackedAllowance memory a = _allowance[user][token][spender];
        return (a.amount, a.expiration, a.nonce);
    }

    function approve(address token, address spender, uint160 amount, uint48 expiration) external override {
        PackedAllowance storage a = _allowance[msg.sender][token][spender];
        a.amount = amount;
        a.expiration = expiration;
        emit Approval(msg.sender, token, spender, amount, expiration);
    }

    function permit(address owner, PermitSingle memory permitSingle, bytes calldata /* signature */) external override {
        PackedAllowance storage a = _allowance[owner][permitSingle.details.token][permitSingle.spender];
        a.amount = permitSingle.details.amount;
        a.expiration = permitSingle.details.expiration;
        a.nonce = permitSingle.details.nonce + 1;
        emit Permit(
            owner,
            permitSingle.details.token,
            permitSingle.spender,
            permitSingle.details.amount,
            permitSingle.details.expiration,
            permitSingle.details.nonce
        );
    }

    function permit(address /* owner */, PermitBatch memory /* permitBatch */, bytes calldata /* signature */) external override {
        // Not exercised in this suite.
    }

    function transferFrom(address from, address to, uint160 amount, address token) external override {
        PackedAllowance storage a = _allowance[from][token][msg.sender];
        require(a.amount >= amount, "MockPermit2: allowance");
        a.amount = a.amount - amount;
        require(IERC20(token).transferFrom(from, to, uint256(amount)), "MockPermit2: transferFrom");
    }

    function transferFrom(AllowanceTransferDetails[] calldata /* transferDetails */) external override {
        // Not exercised in this suite.
    }

    function lockdown(TokenSpenderPair[] calldata /* approvals */) external override {
        // Not exercised in this suite.
    }

    function invalidateNonces(address /* token */, address /* spender */, uint48 /* newNonce */) external override {
        // Not exercised in this suite.
    }
}

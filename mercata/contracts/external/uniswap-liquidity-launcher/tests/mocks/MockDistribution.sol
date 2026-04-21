// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IDistributionStrategy} from "../../src/interfaces/IDistributionStrategy.sol";
import {IDistributionContract} from "../../src/interfaces/IDistributionContract.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice A trivial IDistributionContract that records the tokens it was
/// initialised for and the amount received. Tests read these fields back
/// to verify the LiquidityLauncher orchestration.
contract MockDistributionContract is IDistributionContract {
    address public token;
    uint256 public expectedAmount;
    uint256 public receivedAmount;
    bool public notified;

    function init(address _token, uint256 _expectedAmount) external {
        token = _token;
        expectedAmount = _expectedAmount;
    }

    function onTokensReceived() external override {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal != expectedAmount) revert InvalidAmountReceived(expectedAmount, bal);
        receivedAmount = bal;
        notified = true;
    }
}

/// @notice A trivial IDistributionStrategy that deploys one
/// MockDistributionContract per call and records the token it's for.
contract MockDistributionStrategy is IDistributionStrategy {
    MockDistributionContract public lastDeployed;

    function initializeDistribution(
        address tokenAddress,
        uint256 totalSupply,
        bytes calldata /* configData */,
        bytes32 /* salt */
    ) external override returns (IDistributionContract distributionContract) {
        MockDistributionContract d = new MockDistributionContract();
        d.init(tokenAddress, totalSupply);
        lastDeployed = d;
        distributionContract = IDistributionContract(address(d));
        emit DistributionInitialized(address(d), tokenAddress, totalSupply);
    }
}

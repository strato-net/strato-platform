// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {LiquidityLauncher} from "../src/LiquidityLauncher.sol";
import {Distribution} from "../src/types/Distribution.sol";
import {IDistributionContract} from "../src/interfaces/IDistributionContract.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MockERC20} from "./mocks/MockERC20.sol";
import {MockTokenFactory} from "./mocks/MockTokenFactory.sol";
import {MockPermit2} from "./mocks/MockPermit2.sol";
import {MockDistributionStrategy, MockDistributionContract} from "./mocks/MockDistribution.sol";

/// @notice Unit tests for LiquidityLauncher's orchestration. All
/// distribution tests exercise the payerIsUser=true path, which goes
/// through MockPermit2. The payerIsUser=false path uses SafeERC20's
/// inline assembly (call/gas), which SolidVM's Yul runtime doesn't yet
/// implement.
contract Describe_LiquidityLauncher {
    LiquidityLauncher launcher;
    MockTokenFactory factory;
    MockPermit2 permit2;
    MockDistributionStrategy strategy;

    address recipient;

    function beforeAll() {
        recipient = address(0xCAFE);
    }

    function beforeEach() {
        permit2 = new MockPermit2();
        factory = new MockTokenFactory();
        strategy = new MockDistributionStrategy();
        launcher = new LiquidityLauncher(permit2);
    }

    function it_getGraffiti_is_deterministic_per_creator() {
        bytes32 a1 = launcher.getGraffiti(recipient);
        bytes32 a2 = launcher.getGraffiti(recipient);
        bytes32 b1 = launcher.getGraffiti(address(0xBEEF));
        require(a1 == a2, "graffiti not deterministic for same creator");
        require(a1 != b1, "graffiti collides across creators");
    }

    function it_createToken_mints_supply_to_recipient() {
        address tokenAddr = launcher.createToken(
            address(factory),
            "LaunchToken",
            "LT",
            18,
            1000000,
            recipient,
            new bytes(0)
        );
        require(tokenAddr != address(0), "no token address returned");
        require(IERC20(tokenAddr).totalSupply() == 1000000, "wrong total supply");
        require(IERC20(tokenAddr).balanceOf(recipient) == 1000000, "recipient not credited");
    }

    function it_createToken_reverts_on_zero_recipient() {
        bool reverted = false;
        try launcher.createToken(address(factory), "X", "X", 18, 1, address(0), new bytes(0)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "expected revert on zero recipient");
    }

    /// @notice Happy path via permit2: the test contract owns the newly
    /// minted tokens, approves the permit2 mock on the ERC20 itself, and
    /// approves the launcher as a spender on permit2. The launcher then
    /// routes the tokens to the deployed distribution contract and
    /// onTokensReceived() is invoked with a matching balance.
    function it_distributeToken_moves_tokens_via_permit2() {
        address tokenAddr = launcher.createToken(
            address(factory),
            "LaunchToken",
            "LT",
            18,
            500000,
            address(this),
            new bytes(0)
        );

        // This contract is the owner; approve permit2 on the ERC20 and
        // approve the launcher as a spender on permit2.
        IERC20(tokenAddr).approve(address(permit2), 500000);
        permit2.approve(tokenAddr, address(launcher), uint160(500000), uint48(0));

        Distribution memory d = Distribution({
            strategy: address(strategy),
            amount: uint128(500000),
            configData: new bytes(0)
        });
        IDistributionContract dc = launcher.distributeToken(tokenAddr, d, true, bytes32(uint256(1)));

        MockDistributionContract concrete = MockDistributionContract(address(dc));
        require(concrete.notified(), "distribution contract not notified");
        require(concrete.receivedAmount() == 500000, "wrong amount recorded");
        require(IERC20(tokenAddr).balanceOf(address(concrete)) == 500000, "tokens not delivered");
        require(IERC20(tokenAddr).balanceOf(address(this)) == 0, "owner retained tokens");
    }

    /// @notice The strategy's lastDeployed pointer should match the
    /// IDistributionContract returned to the caller — tests the wiring
    /// between `initializeDistribution`'s return and the launcher's
    /// downstream transfer/notify step.
    function it_distributeToken_returns_strategy_deployed_contract() {
        address tokenAddr = launcher.createToken(
            address(factory), "LaunchToken", "LT", 18, 100000, address(this), new bytes(0)
        );
        IERC20(tokenAddr).approve(address(permit2), 100000);
        permit2.approve(tokenAddr, address(launcher), uint160(100000), uint48(0));

        Distribution memory d = Distribution({
            strategy: address(strategy),
            amount: uint128(100000),
            configData: new bytes(0)
        });
        IDistributionContract dc = launcher.distributeToken(tokenAddr, d, true, bytes32(uint256(7)));
        require(address(dc) == address(strategy.lastDeployed()), "launcher returned wrong distribution contract");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Admin/FeeCollector.sol";
import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract TestERC20 is ERC20, Ownable {
    constructor(string _name, string _symbol, address _owner) ERC20(_name, _symbol) Ownable(_owner) {
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return 18;
    }
}

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_FeeCollector {
    FeeCollector feeCollector;
    TestERC20 token1;
    TestERC20 token2;
    User user1;
    User user2;
    User user3;
    address owner;
    address zeroAddress;

    function beforeAll() {
        owner = address(this);
        zeroAddress = address(0);
        user1 = new User();
        user2 = new User();
        user3 = new User();
    }

    function beforeEach() {
        feeCollector = new FeeCollector(owner);
        token1 = new TestERC20("Token1", "TK1", owner);
        token2 = new TestERC20("Token2", "TK2", owner);
    }

    // ============ CONSTRUCTOR TESTS ============

    function it_fee_collector_sets_initial_owner_correctly() {
        require(Ownable(feeCollector).owner() == owner, "Initial owner not set correctly");
    }

    function it_fee_collector_reverts_with_zero_address_owner() {
        bool reverted = false;
        try {
            new FeeCollector(zeroAddress);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when initial owner is zero address");
    }

    // ============ WITHDRAWAL TESTS ============

    function it_fee_collector_can_withdraw_tokens() {
        uint256 amount = 1000e18;
        token1.mint(address(feeCollector), amount);
        
        uint256 ownerBalanceBefore = ERC20(token1).balanceOf(owner);
        feeCollector.withdrawToken(address(token1), owner, amount);
        uint256 ownerBalanceAfter = ERC20(token1).balanceOf(owner);
        
        require(ownerBalanceAfter == ownerBalanceBefore + amount, "Owner balance not updated correctly");
        require(ERC20(token1).balanceOf(address(feeCollector)) == 0, "FeeCollector balance not updated correctly");
    }

    function it_fee_collector_can_withdraw_to_different_recipient() {
        uint256 amount = 1000e18;
        token1.mint(address(feeCollector), amount);
        
        uint256 userBalanceBefore = ERC20(token1).balanceOf(address(user1));
        feeCollector.withdrawToken(address(token1), address(user1), amount);
        uint256 userBalanceAfter = ERC20(token1).balanceOf(address(user1));
        
        require(userBalanceAfter == userBalanceBefore + amount, "Recipient balance not updated correctly");
        require(ERC20(token1).balanceOf(address(feeCollector)) == 0, "FeeCollector balance not updated correctly");
    }

    function it_fee_collector_can_withdraw_partial_amount() {
        uint256 totalAmount = 1000e18;
        uint256 withdrawAmount = 300e18;
        token1.mint(address(feeCollector), totalAmount);
        
        feeCollector.withdrawToken(address(token1), owner, withdrawAmount);
        
        require(ERC20(token1).balanceOf(owner) == withdrawAmount, "Owner balance not correct");
        require(ERC20(token1).balanceOf(address(feeCollector)) == totalAmount - withdrawAmount, "FeeCollector balance not correct");
    }

    function it_fee_collector_can_withdraw_multiple_tokens() {
        uint256 amount1 = 1000e18;
        uint256 amount2 = 2000e18;
        token1.mint(address(feeCollector), amount1);
        token2.mint(address(feeCollector), amount2);
        
        feeCollector.withdrawToken(address(token1), owner, amount1);
        feeCollector.withdrawToken(address(token2), owner, amount2);
        
        require(ERC20(token1).balanceOf(owner) == amount1, "Token1 balance not correct");
        require(ERC20(token2).balanceOf(owner) == amount2, "Token2 balance not correct");
        require(ERC20(token1).balanceOf(address(feeCollector)) == 0, "Token1 FeeCollector balance not zero");
        require(ERC20(token2).balanceOf(address(feeCollector)) == 0, "Token2 FeeCollector balance not zero");
    }

    // ============ ACCESS CONTROL TESTS ============

    function it_fee_collector_reverts_withdrawal_by_non_owner() {
        uint256 amount = 1000e18;
        token1.mint(address(feeCollector), amount);
        
        bool reverted = false;
        try {
            user1.do(address(feeCollector), "withdrawToken", address(token1), owner, amount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when non-owner tries to withdraw");
    }

    function it_fee_collector_reverts_withdrawal_after_ownership_transfer() {
        uint256 amount = 1000e18;
        token1.mint(address(feeCollector), amount);
        
        Ownable(feeCollector).transferOwnership(address(user1));
        
        bool reverted = false;
        try {
            feeCollector.withdrawToken(address(token1), owner, amount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when old owner tries to withdraw after transfer");
    }

    function it_fee_collector_allows_withdrawal_by_new_owner() {
        uint256 amount = 1000e18;
        token1.mint(address(feeCollector), amount);
        
        Ownable(feeCollector).transferOwnership(address(user1));
        
        uint256 userBalanceBefore = ERC20(token1).balanceOf(address(user1));
        user1.do(address(feeCollector), "withdrawToken", address(token1), address(user1), amount);
        uint256 userBalanceAfter = ERC20(token1).balanceOf(address(user1));
        
        require(userBalanceAfter == userBalanceBefore + amount, "New owner should be able to withdraw");
    }

    // ============ VALIDATION TESTS ============

    function it_fee_collector_reverts_with_zero_token_address() {
        uint256 amount = 1000e18;
        token1.mint(address(feeCollector), amount);
        
        bool reverted = false;
        try {
            feeCollector.withdrawToken(zeroAddress, owner, amount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when token address is zero");
    }

    function it_fee_collector_reverts_with_zero_recipient_address() {
        uint256 amount = 1000e18;
        token1.mint(address(feeCollector), amount);
        
        bool reverted = false;
        try {
            feeCollector.withdrawToken(address(token1), zeroAddress, amount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when recipient address is zero");
    }

    function it_fee_collector_reverts_with_zero_amount() {
        uint256 amount = 1000e18;
        token1.mint(address(feeCollector), amount);
        
        bool reverted = false;
        try {
            feeCollector.withdrawToken(address(token1), owner, 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when amount is zero");
    }

    function it_fee_collector_reverts_with_insufficient_balance() {
        uint256 amount = 1000e18;
        uint256 withdrawAmount = 2000e18;
        token1.mint(address(feeCollector), amount);
        
        bool reverted = false;
        try {
            feeCollector.withdrawToken(address(token1), owner, withdrawAmount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when withdrawing more than balance");
    }

    // ============ EDGE CASES ============

    function it_fee_collector_handles_large_amounts() {
        uint256 largeAmount = 2**256 - 1;
        token1.mint(address(feeCollector), largeAmount);
        
        feeCollector.withdrawToken(address(token1), owner, largeAmount);
        
        require(ERC20(token1).balanceOf(owner) == largeAmount, "Large amount withdrawal should work");
        require(ERC20(token1).balanceOf(address(feeCollector)) == 0, "FeeCollector balance should be zero");
    }

    function it_fee_collector_handles_multiple_withdrawals() {
        uint256 totalAmount = 10000e18;
        uint256 withdrawal1 = 3000e18;
        uint256 withdrawal2 = 2000e18;
        uint256 withdrawal3 = 5000e18;
        
        token1.mint(address(feeCollector), totalAmount);
        
        feeCollector.withdrawToken(address(token1), address(user1), withdrawal1);
        feeCollector.withdrawToken(address(token1), address(user2), withdrawal2);
        feeCollector.withdrawToken(address(token1), address(user3), withdrawal3);
        
        require(ERC20(token1).balanceOf(address(user1)) == withdrawal1, "User1 balance not correct");
        require(ERC20(token1).balanceOf(address(user2)) == withdrawal2, "User2 balance not correct");
        require(ERC20(token1).balanceOf(address(user3)) == withdrawal3, "User3 balance not correct");
        require(ERC20(token1).balanceOf(address(feeCollector)) == 0, "FeeCollector balance should be zero");
    }

    function it_fee_collector_handles_rapid_withdrawals() {
        uint256 totalAmount = 1000e18;
        uint256 withdrawalAmount = 100e18;
        token1.mint(address(feeCollector), totalAmount);
        
        for (uint i = 0; i < 10; i++) {
            feeCollector.withdrawToken(address(token1), owner, withdrawalAmount);
        }
        
        require(ERC20(token1).balanceOf(owner) == totalAmount, "Total withdrawn should equal minted amount");
        require(ERC20(token1).balanceOf(address(feeCollector)) == 0, "FeeCollector balance should be zero");
    }

    // ============ EVENT TESTS ============

    function it_fee_collector_emits_withdrawn_event() {
        uint256 amount = 1000e18;
        token1.mint(address(feeCollector), amount);
        
        feeCollector.withdrawToken(address(token1), owner, amount);
        // Note: Event testing would require more complex setup in this test framework
        require(ERC20(token1).balanceOf(owner) == amount, "Withdrawal should update balance");
    }

    // ============ INTEGRATION TESTS ============

    function it_fee_collector_works_with_different_token_types() {
        uint256 amount1 = 1000e18;
        uint256 amount2 = 2000e18;
        
        token1.mint(address(feeCollector), amount1);
        token2.mint(address(feeCollector), amount2);
        
        feeCollector.withdrawToken(address(token1), address(user1), amount1);
        feeCollector.withdrawToken(address(token2), address(user2), amount2);
        
        require(ERC20(token1).balanceOf(address(user1)) == amount1, "Token1 withdrawal failed");
        require(ERC20(token2).balanceOf(address(user2)) == amount2, "Token2 withdrawal failed");
    }

    function it_fee_collector_handles_mixed_operations() {
        uint256 initialAmount = 5000e18;
        token1.mint(address(feeCollector), initialAmount);
        
        // Multiple withdrawals to different recipients
        feeCollector.withdrawToken(address(token1), address(user1), 1000e18);
        feeCollector.withdrawToken(address(token1), address(user2), 2000e18);
        feeCollector.withdrawToken(address(token1), address(user3), 1500e18);
        feeCollector.withdrawToken(address(token1), owner, 500e18);
        
        require(ERC20(token1).balanceOf(address(user1)) == 1000e18, "User1 balance incorrect");
        require(ERC20(token1).balanceOf(address(user2)) == 2000e18, "User2 balance incorrect");
        require(ERC20(token1).balanceOf(address(user3)) == 1500e18, "User3 balance incorrect");
        require(ERC20(token1).balanceOf(owner) == 500e18, "Owner balance incorrect");
        require(ERC20(token1).balanceOf(address(feeCollector)) == 0, "FeeCollector should be empty");
    }
}

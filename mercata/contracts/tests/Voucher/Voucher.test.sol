// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Voucher/Voucher.sol";
import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_Voucher {
    Voucher voucher;
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
        voucher = new Voucher();
        voucher.initialize("Test Voucher", "VCH");
    }

    // ============ CONSTRUCTOR TESTS ============

    function it_voucher_sets_correct_name_and_symbol() {
        require(keccak256(ERC20(voucher).name()) == keccak256("Test Voucher"), "Name not set correctly");
        require(keccak256(ERC20(voucher).symbol()) == keccak256("VCH"), "Symbol not set correctly");
    }

    function it_voucher_sets_correct_decimals() {
        require(voucher.decimals() == 18, "Decimals not set correctly");
    }

    function it_voucher_sets_initial_owner_correctly() {
        require(Ownable(voucher).owner() == owner, "Initial owner not set correctly");
    }

    function it_voucher_initializes_with_zero_total_supply() {
        require(ERC20(voucher).totalSupply() == 0, "Initial total supply should be 0");
    }

    function it_voucher_initializes_with_zero_balances() {
        require(ERC20(voucher).balanceOf(address(user1)) == 0, "User1 balance should be 0");
        require(ERC20(voucher).balanceOf(address(user2)) == 0, "User2 balance should be 0");
        require(ERC20(voucher).balanceOf(owner) == 0, "Owner balance should be 0");
    }

    // ============ MINT TESTS ============

    function it_voucher_can_mint_tokens() {
        uint256 mintAmount = 1000e18;
        voucher.mint(owner, mintAmount);
        require(ERC20(voucher).totalSupply() == mintAmount, "Total supply not updated correctly");
        require(ERC20(voucher).balanceOf(owner) == mintAmount, "Owner balance not updated correctly");
    }

    function it_voucher_can_mint_to_multiple_addresses() {
        uint256 amount1 = 500e18;
        uint256 amount2 = 300e18;
        voucher.mint(address(user1), amount1);
        voucher.mint(address(user2), amount2);
        require(ERC20(voucher).totalSupply() == amount1 + amount2, "Total supply not updated correctly");
        require(ERC20(voucher).balanceOf(address(user1)) == amount1, "User1 balance not updated correctly");
        require(ERC20(voucher).balanceOf(address(user2)) == amount2, "User2 balance not updated correctly");
    }

    function it_voucher_reverts_minting_by_non_owner() {
        bool reverted = false;
        try {
            user1.do(address(voucher), "mint", address(user2), 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when non-owner tries to mint");
    }

    function it_voucher_reverts_minting_after_ownership_transfer() {
        Ownable(voucher).transferOwnership(address(user1));
        
        bool reverted = false;
        try {
            voucher.mint(owner, 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when old owner tries to mint after transfer");
    }

    function it_voucher_allows_minting_by_new_owner() {
        uint256 mintAmount = 1000e18;
        Ownable(voucher).transferOwnership(address(user1));
        
        user1.do(address(voucher), "mint", address(user1), mintAmount);
        require(ERC20(voucher).balanceOf(address(user1)) == mintAmount, "New owner should be able to mint");
    }

    // ============ BURN TESTS ============

    function it_voucher_can_burn_tokens() {
        uint256 mintAmount = 1000e18;
        uint256 burnAmount = 300e18;
        voucher.mint(owner, mintAmount);
        voucher.burn(owner, burnAmount);
        require(ERC20(voucher).totalSupply() == mintAmount - burnAmount, "Total supply not updated correctly after burn");
        require(ERC20(voucher).balanceOf(owner) == mintAmount - burnAmount, "Owner balance not updated correctly after burn");
    }

    function it_voucher_can_burn_from_different_address() {
        uint256 mintAmount = 1000e18;
        uint256 burnAmount = 300e18;
        voucher.mint(address(user1), mintAmount);
        user1.do(address(voucher), "burn", address(user1), burnAmount);
        require(ERC20(voucher).totalSupply() == mintAmount - burnAmount, "Total supply not updated correctly after burn");
        require(ERC20(voucher).balanceOf(address(user1)) == mintAmount - burnAmount, "User1 balance not updated correctly after burn");
    }

    function it_voucher_reverts_burning_insufficient_balance() {
        uint256 mintAmount = 500e18;
        uint256 burnAmount = 1000e18;
        voucher.mint(owner, mintAmount);
        bool reverted = false;
        try {
            voucher.burn(owner, burnAmount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when burning more than balance");
    }

    function it_voucher_reverts_burning_from_zero_address() {
        bool reverted = false;
        try {
            voucher.burn(zeroAddress, 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when burning from zero address");
    }

    // ============ TRANSFER RESTRICTION TESTS ============

    function it_voucher_transfer_always_returns_false() {
        uint256 mintAmount = 1000e18;
        voucher.mint(owner, mintAmount);
        
        bool result = ERC20(voucher).transfer(address(user1), 100e18);
        require(result == false, "Transfer should always return false");
        require(ERC20(voucher).balanceOf(owner) == mintAmount, "Balance should not change after transfer");
        require(ERC20(voucher).balanceOf(address(user1)) == 0, "Recipient balance should remain 0");
    }

    function it_voucher_transfer_from_always_returns_false() {
        uint256 mintAmount = 1000e18;
        voucher.mint(owner, mintAmount);
        
        bool result = user1.do(address(voucher), "transferFrom", owner, address(user2), 100e18);
        require(result == false, "TransferFrom should always return false");
        require(ERC20(voucher).balanceOf(owner) == mintAmount, "Balance should not change after transferFrom");
        require(ERC20(voucher).balanceOf(address(user2)) == 0, "Recipient balance should remain 0");
    }

    function it_voucher_approve_always_returns_false() {
        bool result = ERC20(voucher).approve(address(user1), 1000e18);
        require(result == false, "Approve should always return false");
    }

    function it_voucher_allowance_always_returns_zero() {
        uint256 allowance = ERC20(voucher).allowance(owner, address(user1));
        require(allowance == 0, "Allowance should always return 0");
    }

    function it_voucher_transfer_restrictions_work_with_any_amount() {
        uint256 mintAmount = 1000e18;
        voucher.mint(owner, mintAmount);
        
        // Try different amounts
        bool result1 = ERC20(voucher).transfer(address(user1), 0);
        bool result2 = ERC20(voucher).transfer(address(user1), 1);
        bool result3 = ERC20(voucher).transfer(address(user1), mintAmount);
        bool result4 = ERC20(voucher).transfer(address(user1), 2**256 - 1);
        
        require(result1 == false, "Transfer with 0 amount should return false");
        require(result2 == false, "Transfer with 1 amount should return false");
        require(result3 == false, "Transfer with full balance should return false");
        require(result4 == false, "Transfer with max amount should return false");
        
        require(ERC20(voucher).balanceOf(owner) == mintAmount, "Balance should not change");
        require(ERC20(voucher).balanceOf(address(user1)) == 0, "Recipient balance should remain 0");
    }

    // ============ EDGE CASES ============

    function it_voucher_handles_large_amounts() {
        uint256 largeAmount = 2**256 - 1;
        voucher.mint(owner, largeAmount);
        require(ERC20(voucher).totalSupply() == largeAmount, "Large amount minting should work");
        require(ERC20(voucher).balanceOf(owner) == largeAmount, "Large amount balance should work");
    }

    function it_voucher_handles_zero_amount_operations() {
        voucher.mint(owner, 0);
        require(ERC20(voucher).balanceOf(owner) == 0, "Zero amount mint should work");
        
        voucher.mint(owner, 1000e18);
        voucher.burn(owner, 0);
        require(ERC20(voucher).balanceOf(owner) == 1000e18, "Zero amount burn should work");
    }

    function it_voucher_handles_rapid_minting_and_burning() {
        for (uint i = 0; i < 5; i++) {
            voucher.mint(owner, 100e18);
            voucher.burn(owner, 50e18);
        }
        require(ERC20(voucher).balanceOf(owner) == 250e18, "Balance not correct after rapid operations");
        require(ERC20(voucher).totalSupply() == 250e18, "Total supply not correct after rapid operations");
    }

    function it_voucher_handles_multiple_recipients() {
        uint256 amount1 = 1000e18;
        uint256 amount2 = 2000e18;
        uint256 amount3 = 1500e18;
        
        voucher.mint(address(user1), amount1);
        voucher.mint(address(user2), amount2);
        voucher.mint(address(user3), amount3);
        
        require(ERC20(voucher).balanceOf(address(user1)) == amount1, "User1 balance not correct");
        require(ERC20(voucher).balanceOf(address(user2)) == amount2, "User2 balance not correct");
        require(ERC20(voucher).balanceOf(address(user3)) == amount3, "User3 balance not correct");
        require(ERC20(voucher).totalSupply() == amount1 + amount2 + amount3, "Total supply not correct");
    }

    // ============ VOUCHER-SPECIFIC BEHAVIOR TESTS ============

    function it_voucher_maintains_transfer_restrictions_after_minting() {
        uint256 mintAmount = 1000e18;
        voucher.mint(owner, mintAmount);
        
        // Even with tokens, transfers should still be restricted
        bool result = ERC20(voucher).transfer(address(user1), 100e18);
        require(result == false, "Transfer should still be restricted after minting");
        require(ERC20(voucher).balanceOf(owner) == mintAmount, "Balance should not change");
    }

    function it_voucher_maintains_transfer_restrictions_after_burning() {
        uint256 mintAmount = 1000e18;
        uint256 burnAmount = 300e18;
        voucher.mint(owner, mintAmount);
        voucher.burn(owner, burnAmount);
        
        // Even after burning, transfers should still be restricted
        bool result = ERC20(voucher).transfer(address(user1), 100e18);
        require(result == false, "Transfer should still be restricted after burning");
        require(ERC20(voucher).balanceOf(owner) == mintAmount - burnAmount, "Balance should not change");
    }

    function it_voucher_handles_ownership_transfer_with_restrictions() {
        uint256 mintAmount = 1000e18;
        voucher.mint(owner, mintAmount);
        Ownable(voucher).transferOwnership(address(user1));
        
        // Old owner should not be able to transfer
        bool result1 = ERC20(voucher).transfer(address(user2), 100e18);
        require(result1 == false, "Old owner should not be able to transfer");
        
        // New owner should also not be able to transfer (voucher restriction)
        bool result2 = user1.do(address(voucher), "transfer", address(user2), 100e18);
        require(result2 == false, "New owner should also not be able to transfer");
        
        require(ERC20(voucher).balanceOf(owner) == mintAmount, "Balance should not change");
    }

    // ============ INTEGRATION TESTS ============

    function it_voucher_handles_complete_lifecycle() {
        // 1. Initial state
        require(ERC20(voucher).totalSupply() == 0, "Should start with zero supply");
        require(Ownable(voucher).owner() == owner, "Should have correct owner");
        
        // 2. Mint tokens
        uint256 mintAmount1 = 1000e18;
        uint256 mintAmount2 = 2000e18;
        voucher.mint(address(user1), mintAmount1);
        voucher.mint(address(user2), mintAmount2);
        
        require(ERC20(voucher).totalSupply() == mintAmount1 + mintAmount2, "Total supply should be correct");
        require(ERC20(voucher).balanceOf(address(user1)) == mintAmount1, "User1 balance should be correct");
        require(ERC20(voucher).balanceOf(address(user2)) == mintAmount2, "User2 balance should be correct");
        
        // 3. Verify transfer restrictions
        bool transferResult = ERC20(voucher).transfer(address(user3), 100e18);
        require(transferResult == false, "Transfer should be restricted");
        
        // 4. Burn tokens
        uint256 burnAmount = 500e18;
        user1.do(address(voucher), "burn", address(user1), burnAmount);
        
        require(ERC20(voucher).totalSupply() == mintAmount1 + mintAmount2 - burnAmount, "Total supply should be updated");
        require(ERC20(voucher).balanceOf(address(user1)) == mintAmount1 - burnAmount, "User1 balance should be updated");
        
        // 5. Transfer ownership
        Ownable(voucher).transferOwnership(address(user3));
        require(Ownable(voucher).owner() == address(user3), "Ownership should be transferred");
        
        // 6. New owner can mint
        uint256 mintAmount3 = 500e18;
        user3.do(address(voucher), "mint", address(user3), mintAmount3);
        require(ERC20(voucher).balanceOf(address(user3)) == mintAmount3, "New owner should be able to mint");
    }

    function it_voucher_handles_mixed_operations() {
        // Mint to multiple addresses
        voucher.mint(owner, 1000e18);
        voucher.mint(address(user1), 2000e18);
        voucher.mint(address(user2), 1500e18);
        
        // Burn from different addresses
        voucher.burn(owner, 300e18);
        user1.do(address(voucher), "burn", address(user1), 500e18);
        
        // Verify final state
        require(ERC20(voucher).balanceOf(owner) == 700e18, "Owner balance not correct");
        require(ERC20(voucher).balanceOf(address(user1)) == 1500e18, "User1 balance not correct");
        require(ERC20(voucher).balanceOf(address(user2)) == 1500e18, "User2 balance not correct");
        require(ERC20(voucher).totalSupply() == 3700e18, "Total supply not correct");
        
        // Verify transfer restrictions still apply
        bool result = ERC20(voucher).transfer(address(user3), 100e18);
        require(result == false, "Transfer should still be restricted");
    }
}

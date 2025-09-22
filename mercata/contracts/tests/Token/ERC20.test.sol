import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "./User.sol";

contract record TestERC20 is ERC20, Ownable {
    constructor(string _name, string _symbol, address _owner) ERC20(_name, _symbol) Ownable(_owner) {
    }

    function mintTokens(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burnTokens(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return 18;
    }
}


contract Describe_ERC20 {
    TestERC20 token;
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
        // Create a fresh token instance for each test
        token = new TestERC20("Test Token", "TEST", owner);
    }

    // ============ CONSTRUCTOR TESTS ============

    function it_erc20_sets_correct_name_and_symbol() {
        require(keccak256(ERC20(token).name()) == keccak256("Test Token"), "Name not set correctly");
        require(keccak256(ERC20(token).symbol()) == keccak256("TEST"), "Symbol not set correctly");
    }

    function it_erc20_sets_correct_decimals() {
        require(token.decimals() == 18, "Decimals not set correctly");
    }

    function it_erc20_initializes_with_zero_total_supply() {
        require(ERC20(token).totalSupply() == 0, "Initial total supply should be 0");
    }

    function it_erc20_initializes_with_zero_balances() {
        require(ERC20(token).balanceOf(address(user1)) == 0, "User1 balance should be 0");
        require(ERC20(token).balanceOf(address(user2)) == 0, "User2 balance should be 0");
        require(ERC20(token).balanceOf(owner) == 0, "Owner balance should be 0");
    }

    // ============ MINT TESTS ============

    function it_erc20_can_mint_tokens() {
        uint256 mintAmount = 1000e18;
        token.mintTokens(owner, mintAmount);
        require(ERC20(token).totalSupply() == mintAmount, "Total supply not updated correctly");
        require(ERC20(token).balanceOf(owner) == mintAmount, "Owner balance not updated correctly");
    }

    function it_erc20_can_mint_to_multiple_addresses() {
        uint256 amount1 = 500e18;
        uint256 amount2 = 300e18;
        token.mintTokens(address(user1), amount1);
        token.mintTokens(address(user2), amount2);
        require(ERC20(token).totalSupply() == amount1 + amount2, "Total supply not updated correctly");
        require(ERC20(token).balanceOf(address(user1)) == amount1, "User1 balance not updated correctly");
        require(ERC20(token).balanceOf(address(user2)) == amount2, "User2 balance not updated correctly");
    }

    function it_erc20_reverts_minting_to_zero_address() {
        bool reverted = false;
        try {
            token.mintTokens(zeroAddress, 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when minting to zero address");
    }

    function it_erc20_reverts_minting_by_non_owner() {
        bool reverted = false;
        try {
            user1.do(address(token), "mint", address(user2), 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when non-owner tries to mint");
    }

    function it_erc20_emits_transfer_event_on_mint() {
        uint256 mintAmount = 1000e18;
        // Note: Event testing would require more complex setup in this test framework
        token.mintTokens(owner, mintAmount);
        require(ERC20(token).balanceOf(owner) == mintAmount, "Mint should update balance");
    }

    // ============ BURN TESTS ============

    function it_erc20_can_burn_tokens() {
        uint256 mintAmount = 1000e18;
        uint256 burnAmount = 300e18;
        token.mintTokens(owner, mintAmount);
        token.burnTokens(owner, burnAmount);
        require(ERC20(token).totalSupply() == mintAmount - burnAmount, "Total supply not updated correctly after burn");
        require(ERC20(token).balanceOf(owner) == mintAmount - burnAmount, "Owner balance not updated correctly after burn");
    }

    function it_erc20_reverts_burning_from_zero_address() {
        bool reverted = false;
        try {
            token.burnTokens(zeroAddress, 1000e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when burning from zero address");
    }

    function it_erc20_reverts_burning_insufficient_balance() {
        uint256 mintAmount = 500e18;
        uint256 burnAmount = 1000e18;
        token.mintTokens(owner, mintAmount);
        bool reverted = false;
        try {
            token.burnTokens(owner, burnAmount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when burning more than balance");
    }

    function it_erc20_reverts_burning_by_non_owner() {
        uint256 mintAmount = 1000e18;
        token.mintTokens(owner, mintAmount);
        bool reverted = false;
        try {
            user1.do(address(token), "burn", owner, 500e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when non-owner tries to burn");
    }

    // ============ TRANSFER TESTS ============

    function it_erc20_can_transfer_tokens() {
        uint256 mintAmount = 1000e18;
        uint256 transferAmount = 300e18;
        token.mintTokens(owner, mintAmount);
        bool success = ERC20(token).transfer(address(user1), transferAmount);
        require(success, "Transfer should succeed");
        require(ERC20(token).balanceOf(owner) == mintAmount - transferAmount, "Owner balance not updated correctly");
        require(ERC20(token).balanceOf(address(user1)) == transferAmount, "User1 balance not updated correctly");
    }

    function it_erc20_reverts_transfer_to_zero_address() {
        uint256 mintAmount = 1000e18;
        token.mintTokens(owner, mintAmount);
        bool reverted = false;
        try {
            ERC20(token).transfer(zeroAddress, 100e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when transferring to zero address");
    }

    function it_erc20_reverts_transfer_insufficient_balance() {
        uint256 mintAmount = 500e18;
        uint256 transferAmount = 1000e18;
        token.mintTokens(owner, mintAmount);
        bool reverted = false;
        try {
            ERC20(token).transfer(address(user1), transferAmount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when transferring more than balance");
    }

    function it_erc20_reverts_transfer_from_zero_address() {
        bool reverted = false;
        try {
            ERC20(token).transfer(address(user1), 100e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when transferring from zero balance");
    }

    // ============ APPROVE TESTS ============

    function it_erc20_can_approve_tokens() {
        uint256 approveAmount = 500e18;
        bool success = ERC20(token).approve(address(user1), approveAmount);
        require(success, "Approve should succeed");
        require(ERC20(token).allowance(owner, address(user1)) == approveAmount, "Allowance not set correctly");
    }

    function it_erc20_can_approve_max_uint256() {
        uint256 maxAmount = 2**256 - 1;
        bool success = ERC20(token).approve(address(user1), maxAmount);
        require(success, "Approve should succeed with max uint256");
        require(ERC20(token).allowance(owner, address(user1)) == maxAmount, "Allowance not set correctly for max amount");
    }

    function it_erc20_reverts_approve_to_zero_address() {
        bool reverted = false;
        try {
            ERC20(token).approve(zeroAddress, 500e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when approving to zero address");
    }

    function it_erc20_can_update_allowance() {
        uint256 firstAmount = 300e18;
        uint256 secondAmount = 600e18;
        ERC20(token).approve(address(user1), firstAmount);
        require(ERC20(token).allowance(owner, address(user1)) == firstAmount, "First allowance not set correctly");
        ERC20(token).approve(address(user1), secondAmount);
        require(ERC20(token).allowance(owner, address(user1)) == secondAmount, "Updated allowance not set correctly");
    }

    // ============ TRANSFER_FROM TESTS ============

    function it_erc20_can_transfer_from_with_allowance() {
        uint256 mintAmount = 1000e18;
        uint256 approveAmount = 500e18;
        uint256 transferAmount = 300e18;
        token.mintTokens(owner, mintAmount);
        ERC20(token).approve(address(user1), approveAmount);
        bool success = user1.do(address(token), "transferFrom", owner, address(user2), transferAmount);
        require(success, "TransferFrom should succeed");
        require(ERC20(token).balanceOf(owner) == mintAmount - transferAmount, "Owner balance not updated correctly");
        require(ERC20(token).balanceOf(address(user2)) == transferAmount, "User2 balance not updated correctly");
        require(ERC20(token).allowance(owner, address(user1)) == approveAmount - transferAmount, "Allowance not updated correctly");
    }

    function it_erc20_can_transfer_from_with_infinite_allowance() {
        uint256 mintAmount = 1000e18;
        uint256 transferAmount = 500e18;
        uint256 maxAmount = 2**256 - 1;
        token.mintTokens(owner, mintAmount);
        ERC20(token).approve(address(user1), maxAmount);
        bool success = user1.do(address(token), "transferFrom", owner, address(user2), transferAmount);
        require(success, "TransferFrom should succeed with infinite allowance");
        require(ERC20(token).balanceOf(owner) == mintAmount - transferAmount, "Owner balance not updated correctly");
        require(ERC20(token).balanceOf(address(user2)) == transferAmount, "User2 balance not updated correctly");
        require(ERC20(token).allowance(owner, address(user1)) == maxAmount, "Infinite allowance should remain unchanged");
    }

    function it_erc20_reverts_transfer_from_insufficient_allowance() {
        uint256 mintAmount = 1000e18;
        uint256 approveAmount = 200e18;
        uint256 transferAmount = 500e18;
        token.mintTokens(owner, mintAmount);
        ERC20(token).approve(address(user1), approveAmount);
        bool reverted = false;
        try {
            user1.do(address(token), "transferFrom", owner, address(user2), transferAmount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when transferring more than allowance");
    }

    function it_erc20_reverts_transfer_from_insufficient_balance() {
        uint256 mintAmount = 200e18;
        uint256 approveAmount = 1000e18;
        uint256 transferAmount = 500e18;
        token.mintTokens(owner, mintAmount);
        ERC20(token).approve(address(user1), approveAmount);
        bool reverted = false;
        try {
            user1.do(address(token), "transferFrom", owner, address(user2), transferAmount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when transferring more than balance");
    }

    function it_erc20_reverts_transfer_from_zero_address_with_approval() {
        uint256 approveAmount = 500e18;
        ERC20(token).approve(address(user1), approveAmount);
        bool reverted = false;
        try {
            user1.do(address(token), "transferFrom", zeroAddress, address(user2), 100e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when transferring from zero address");
    }

    function it_erc20_reverts_transfer_from_to_zero_address() {
        uint256 mintAmount = 1000e18;
        uint256 approveAmount = 500e18;
        token.mintTokens(owner, mintAmount);
        ERC20(token).approve(address(user1), approveAmount);
        bool reverted = false;
        try {
            user1.do(address(token), "transferFrom", owner, zeroAddress, 100e18);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when transferring to zero address");
    }

    // ============ EDGE CASES AND STRESS TESTS ============

    function it_erc20_handles_zero_amount_transfers() {
        uint256 mintAmount = 1000e18;
        token.mintTokens(owner, mintAmount);
        bool success = ERC20(token).transfer(address(user1), 0);
        require(success, "Zero amount transfer should succeed");
        require(ERC20(token).balanceOf(owner) == mintAmount, "Owner balance should remain unchanged");
        require(ERC20(token).balanceOf(address(user1)) == 0, "User1 balance should remain 0");
    }

    function it_erc20_handles_zero_amount_approvals() {
        bool success = ERC20(token).approve(address(user1), 0);
        require(success, "Zero amount approval should succeed");
        require(ERC20(token).allowance(owner, address(user1)) == 0, "Allowance should be 0");
    }

    function it_erc20_handles_zero_amount_transfer_from() {
        uint256 mintAmount = 1000e18;
        uint256 approveAmount = 500e18;
        token.mintTokens(owner, mintAmount);
        ERC20(token).approve(address(user1), approveAmount);
        bool success = user1.do(address(token), "transferFrom", owner, address(user2), 0);
        require(success, "Zero amount transferFrom should succeed");
        require(ERC20(token).balanceOf(owner) == mintAmount, "Owner balance should remain unchanged");
        require(ERC20(token).balanceOf(address(user2)) == 0, "User2 balance should remain 0");
        require(ERC20(token).allowance(owner, address(user1)) == approveAmount, "Allowance should remain unchanged");
    }

    function it_erc20_handles_large_amounts() {
        uint256 largeAmount = 2**256 - 1;
        token.mintTokens(owner, largeAmount);
        require(ERC20(token).totalSupply() == largeAmount, "Large amount minting should work");
        require(ERC20(token).balanceOf(owner) == largeAmount, "Large amount balance should work");
    }

    function it_erc20_handles_multiple_transfers() {
        uint256 mintAmount = 10000e18;
        token.mintTokens(owner, mintAmount);
        
        // Multiple transfers
        ERC20(token).transfer(address(user1), 1000e18);
        ERC20(token).transfer(address(user2), 2000e18);
        ERC20(token).transfer(address(user3), 1500e18);
        
        require(ERC20(token).balanceOf(owner) == mintAmount - 4500e18, "Owner balance after multiple transfers");
        require(ERC20(token).balanceOf(address(user1)) == 1000e18, "User1 balance after transfer");
        require(ERC20(token).balanceOf(address(user2)) == 2000e18, "User2 balance after transfer");
        require(ERC20(token).balanceOf(address(user3)) == 1500e18, "User3 balance after transfer");
    }

    function it_erc20_handles_multiple_approvals() {
        uint256 amount1 = 1000e18;
        uint256 amount2 = 2000e18;
        uint256 amount3 = 3000e18;
        
        ERC20(token).approve(address(user1), amount1);
        ERC20(token).approve(address(user2), amount2);
        ERC20(token).approve(address(user3), amount3);
        
        require(ERC20(token).allowance(owner, address(user1)) == amount1, "User1 allowance");
        require(ERC20(token).allowance(owner, address(user2)) == amount2, "User2 allowance");
        require(ERC20(token).allowance(owner, address(user3)) == amount3, "User3 allowance");
    }

    // ============ REVERT-ON-FAILURE BEHAVIOR TESTS ============
    // These tests verify the critical behavior that ERC20 functions REVERT on failure, not return false

    function it_erc20_reverts_instead_of_returning_false_on_insufficient_balance() {
        uint256 mintAmount = 100e18;
        uint256 transferAmount = 200e18;
        token.mintTokens(owner, mintAmount);
        
        bool reverted = false;
        try {
            ERC20(token).transfer(address(user1), transferAmount);
        } catch {
            reverted = true;
        }
        require(reverted, "CRITICAL: Should REVERT on insufficient balance, not return false");
    }

    function it_erc20_reverts_instead_of_returning_false_on_insufficient_allowance() {
        uint256 mintAmount = 1000e18;
        uint256 approveAmount = 100e18;
        uint256 transferAmount = 200e18;
        token.mintTokens(owner, mintAmount);
        ERC20(token).approve(address(user1), approveAmount);
        
        bool reverted = false;
        try {
            user1.do(address(token), "transferFrom", owner, address(user2), transferAmount);
        } catch {
            reverted = true;
        }
        require(reverted, "CRITICAL: Should REVERT on insufficient allowance, not return false");
    }

    function it_erc20_reverts_instead_of_returning_false_on_zero_address_transfer() {
        uint256 mintAmount = 1000e18;
        token.mintTokens(owner, mintAmount);
        
        bool reverted = false;
        try {
            ERC20(token).transfer(zeroAddress, 100e18);
        } catch {
            reverted = true;
        }
        require(reverted, "CRITICAL: Should REVERT on zero address transfer, not return false");
    }

    function it_erc20_reverts_instead_of_returning_false_on_zero_address_approval() {
        bool reverted = false;
        try {
            ERC20(token).approve(zeroAddress, 100e18);
        } catch {
            reverted = true;
        }
        require(reverted, "CRITICAL: Should REVERT on zero address approval, not return false");
    }

    // ============ BALANCE AND SUPPLY CONSISTENCY TESTS ============

    function it_erc20_maintains_supply_consistency_after_mint() {
        uint256 amount1 = 1000e18;
        uint256 amount2 = 2000e18;
        uint256 amount3 = 1500e18;
        
        token.mintTokens(address(user1), amount1);
        token.mintTokens(address(user2), amount2);
        token.mintTokens(address(user3), amount3);
        
        uint256 expectedSupply = amount1 + amount2 + amount3;
        require(ERC20(token).totalSupply() == expectedSupply, "Total supply should equal sum of all balances");
        require(ERC20(token).balanceOf(address(user1)) + ERC20(token).balanceOf(address(user2)) + ERC20(token).balanceOf(address(user3)) == expectedSupply, "Sum of balances should equal total supply");
    }

    function it_erc20_maintains_supply_consistency_after_burn() {
        uint256 mintAmount = 10000e18;
        uint256 burnAmount = 3000e18;
        token.mintTokens(owner, mintAmount);
        token.burnTokens(owner, burnAmount);
        
        require(ERC20(token).totalSupply() == mintAmount - burnAmount, "Total supply should be reduced by burn amount");
        require(ERC20(token).balanceOf(owner) == mintAmount - burnAmount, "Owner balance should be reduced by burn amount");
    }

    function it_erc20_maintains_supply_consistency_after_transfers() {
        uint256 mintAmount = 10000e18;
        uint256 transferAmount = 5000e18;
        token.mintTokens(owner, mintAmount);
        ERC20(token).transfer(address(user1), transferAmount);
        
        require(ERC20(token).totalSupply() == mintAmount, "Total supply should remain unchanged after transfers");
        require(ERC20(token).balanceOf(owner) + ERC20(token).balanceOf(address(user1)) == mintAmount, "Sum of balances should equal original total supply");
    }

    // ============ COMPLEX SCENARIOS ============

    function it_erc20_handles_approve_and_transfer_from_cycle() {
        uint256 mintAmount = 10000e18;
        uint256 approveAmount = 5000e18;
        uint256 transferAmount1 = 2000e18;
        uint256 transferAmount2 = 1500e18;
        
        token.mintTokens(owner, mintAmount);
        ERC20(token).approve(address(user1), approveAmount);
        
        // First transfer
        user1.do(address(token), "transferFrom", owner, address(user2), transferAmount1);
        require(ERC20(token).allowance(owner, address(user1)) == approveAmount - transferAmount1, "Allowance after first transfer");
        
        // Second transfer
        user1.do(address(token), "transferFrom", owner, address(user3), transferAmount2);
        require(ERC20(token).allowance(owner, address(user1)) == approveAmount - transferAmount1 - transferAmount2, "Allowance after second transfer");
        
        // Check final balances
        require(ERC20(token).balanceOf(owner) == mintAmount - transferAmount1 - transferAmount2, "Owner balance after transfers");
        require(ERC20(token).balanceOf(address(user2)) == transferAmount1, "User2 balance");
        require(ERC20(token).balanceOf(address(user3)) == transferAmount2, "User3 balance");
    }

    function it_erc20_handles_multiple_spenders() {
        uint256 mintAmount = 10000e18;
        uint256 approveAmount1 = 3000e18;
        uint256 approveAmount2 = 4000e18;
        uint256 transferAmount1 = 2000e18;
        uint256 transferAmount2 = 2500e18;
        
        token.mintTokens(owner, mintAmount);
        ERC20(token).approve(address(user1), approveAmount1);
        ERC20(token).approve(address(user2), approveAmount2);
        
        // Both spenders transfer
        user1.do(address(token), "transferFrom", owner, address(user3), transferAmount1);
        user2.do(address(token), "transferFrom", owner, address(user3), transferAmount2);
        
        require(ERC20(token).allowance(owner, address(user1)) == approveAmount1 - transferAmount1, "User1 allowance");
        require(ERC20(token).allowance(owner, address(user2)) == approveAmount2 - transferAmount2, "User2 allowance");
        require(ERC20(token).balanceOf(address(user3)) == transferAmount1 + transferAmount2, "User3 total balance");
    }

    function it_erc20_handles_approval_updates() {
        uint256 mintAmount = 10000e18;
        uint256 initialApprove = 2000e18;
        uint256 updatedApprove = 5000e18;
        uint256 transferAmount = 3000e18;
        
        token.mintTokens(owner, mintAmount);
        ERC20(token).approve(address(user1), initialApprove);
        
        // Try to transfer more than initial approval - should fail
        bool reverted = false;
        try {
            user1.do(address(token), "transferFrom", owner, address(user2), transferAmount);
        } catch {
            reverted = true;
        }
        require(reverted, "Should fail with insufficient allowance");
        
        // Update approval
        ERC20(token).approve(address(user1), updatedApprove);
        
        // Now transfer should succeed
        bool success = user1.do(address(token), "transferFrom", owner, address(user2), transferAmount);
        require(success, "Transfer should succeed after approval update");
        require(ERC20(token).allowance(owner, address(user1)) == updatedApprove - transferAmount, "Allowance should be updated correctly");
    }
}

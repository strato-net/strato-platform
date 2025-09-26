import "../../concrete/BaseCodeCollection.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_TokenPausable {
    constructor() {
    }

    Token token;
    User user1;
    User user2;
    User adminUser;

    function beforeAll() {
        // Create test users
        user1 = new User();
        user2 = new User();
        adminUser = new User();
    }

    function beforeEach() {
        // Create a fresh test token directly with initial balance
        token = new Token(
            "Test Token",
            "Test token for pausable operations",
            [],
            [],
            [],
            "TEST",
            1000000 * 10**18, // Initial supply
            18,
            address(this) // Token creator/owner
        );
        
        require(address(token) != address(0), "Token contract not deployed");
    }

    function it_starts_unpaused() {
        // Test that token starts in unpaused state (like BaseCodeCollection)
        bool isPaused = Pausable(token).paused();
        require(!isPaused, "Token should start unpaused");
    }

    function it_allows_owner_to_pause() {
        // Test that owner can pause the token (token starts unpaused)
        token.pause();
        bool isPaused = Pausable(token).paused();
        require(isPaused, "Token should be paused after owner calls pause()");
    }

    function it_allows_owner_to_unpause() {
        // First pause the token (it starts unpaused)
        token.pause();
        bool isPaused = Pausable(token).paused();
        require(isPaused, "Token should be paused");
        
        // Then unpause it
        token.unpause();
        
        isPaused = Pausable(token).paused();
        require(!isPaused, "Token should be unpaused after owner calls unpause()");
    }

    function it_prevents_non_owner_from_pausing() {
        // Test that non-owner cannot pause the token
        bool success = false;
        try user1.do(address(token), "pause()", "") {
            success = true;
        } catch {
            success = false;
        }
        require(!success, "Non-owner should not be able to pause token");
    }

    function it_prevents_non_owner_from_unpausing() {
        // First pause the token as owner
        token.pause();
        bool isPaused = Pausable(token).paused();
        require(isPaused, "Token should be paused");
        
        // Test that non-owner cannot unpause
        bool success = false;
        try user1.do(address(token), "unpause()", "") {
            success = true;
        } catch {
            success = false;
        }
        require(!success, "Non-owner should not be able to unpause token");
    }

    function it_allows_transfers_when_unpaused() {
        // Token starts unpaused, so transfers should work
        bool isPaused = Pausable(token).paused();
        require(!isPaused, "Token should start unpaused");
        
        // Transfer some tokens from owner to user1
        uint256 transferAmount = 1000 * 10**18;
        ERC20(token).transfer(address(user1), transferAmount);
        
        uint256 user1Balance = ERC20(token).balanceOf(address(user1));
        require(user1Balance == transferAmount, "Transfer should work when unpaused");
    }

    function it_blocks_transfers_when_paused() {
        // Pause the token
        token.pause();
        bool isPaused = Pausable(token).paused();
        require(isPaused, "Token should be paused");
        
        // Owner can still transfer when paused (whenNotPausedOrOwner modifier)
        // So let's test with a non-owner user
        uint256 transferAmount = 1000 * 10**18;
        
        // First give user1 some tokens
        ERC20(token).transfer(address(user1), transferAmount);
        
        // Now try to have user1 transfer - this should fail since user1 is not owner/admin
        bool success = false;
        try user1.do(address(token), "transfer(address,uint256)", address(user2), transferAmount) {
            success = true;
        } catch {
            success = false;
        }
        require(!success, "Non-owner transfer should fail when token is paused");
    }

    function it_blocks_transferFrom_when_paused() {
        // Token starts unpaused, so give user1 some tokens first
        uint256 initialAmount = 1000 * 10**18;
        ERC20(token).transfer(address(user1), initialAmount);
        
        // Approve user2 to spend user1's tokens
        user1.do(address(token), "approve(address,uint256)", address(user2), initialAmount);
        
        // Pause the token
        token.pause();
        bool isPaused = Pausable(token).paused();
        require(isPaused, "Token should be paused");
        
        // Try transferFrom - should fail since user2 is not owner/admin
        uint256 transferAmount = 500 * 10**18;
        bool success = false;
        try user2.do(address(token), "transferFrom(address,address,uint256)", address(user1), address(user2), transferAmount) {
            success = true;
        } catch {
            success = false;
        }
        require(!success, "TransferFrom should fail when token is paused");
    }

    function it_allows_mint_when_paused() {
        // First pause the token (it starts unpaused)
        token.pause();
        bool isPaused = Pausable(token).paused();
        require(isPaused, "Token should be paused");
        
        // Owner should still be able to mint (mint doesn't use _transfer)
        uint256 mintAmount = 1000 * 10**18;
        uint256 initialBalance = ERC20(token).balanceOf(address(user1));
        
        token.mint(address(user1), mintAmount);
        
        uint256 finalBalance = ERC20(token).balanceOf(address(user1));
        require(finalBalance == initialBalance + mintAmount, "Mint should work even when paused");
    }

    function it_allows_burn_when_paused() {
        // Token starts unpaused, so give user1 some tokens first
        uint256 initialAmount = 1000 * 10**18;
        ERC20(token).transfer(address(user1), initialAmount);
        
        // Pause the token
        token.pause();
        bool isPaused = Pausable(token).paused();
        require(isPaused, "Token should be paused");
        
        // Owner should still be able to burn (burn doesn't use _transfer)
        uint256 burnAmount = 500 * 10**18;
        uint256 initialBalance = ERC20(token).balanceOf(address(user1));
        
        token.burn(address(user1), burnAmount);
        
        uint256 finalBalance = ERC20(token).balanceOf(address(user1));
        require(finalBalance == initialBalance - burnAmount, "Burn should work even when paused");
    }

    function it_allows_owner_transfer_when_paused() {
        // Pause the token
        token.pause();
        bool isPaused = Pausable(token).paused();
        require(isPaused, "Token should be paused");
        
        // Owner should still be able to transfer when paused (whenNotPausedOrOwner modifier)
        uint256 transferAmount = 1000 * 10**18;
        
        // Owner transfers to user1 - should succeed even when paused
        // This test just verifies the transfer doesn't revert
        ERC20(token).transfer(address(user1), transferAmount);
        
        // Verify user1 received the tokens
        uint256 user1Balance = ERC20(token).balanceOf(address(user1));
        require(user1Balance == transferAmount, "Owner transfer should work when paused");
    }

    function it_supports_multiple_pause_unpause_cycles() {
        // Test multiple pause/unpause cycles
        for (uint i = 0; i < 3; i++) {
            // Pause (token starts unpaused)
            token.pause();
            bool isPaused = Pausable(token).paused();
            require(isPaused, "Token should be paused in cycle");

            // Unpause
            token.unpause();
            isPaused = Pausable(token).paused();
            require(!isPaused, "Token should be unpaused in cycle");
        }
    }

    function it_allows_whitelisted_user_to_transfer_when_paused() {
        // Create AdminRegistry with this contract as admin
        AdminRegistry adminRegistry = new AdminRegistry([this]);
        
        // Create TokenFactory with adminRegistry as owner so we can call createTokenWithInitialOwner
        TokenFactory tokenFactory = new TokenFactory(address(adminRegistry));

        // Create a new token through TokenFactory with this contract as the token owner
        uint256 transferAmount = 500 * 10**18;
        (bool didExecute, variadic ret) = adminRegistry.castVoteOnIssue(
            address(tokenFactory), "createTokenWithInitialOwner",
            "Admin Token",
            "Token for testing admin functionality",
            [],
            [],
            [],
            "ADMIN",
            transferAmount * 2,
            18,
            this
        );
        require(didExecute, "Admin token not created");
        address tokenAddress = address(ret);
        Token adminToken = Token(tokenAddress);

        // Give user1 some tokens
        bool success = ERC20(adminToken).transfer(
            address(user1), 
            transferAmount * 2
        );
        require(success, "this contract should be able to transfer tokens");
        
        // Pause the token
        Token(adminToken).pause();
        bool isPaused = Pausable(adminToken).paused();
        require(isPaused, "Admin token should be paused");
        
        // Try to have user1 transfer - should fail since token is paused
        success = false;
        try user1.do(address(adminToken), "transfer(address,uint256)", address(user2), transferAmount) {
            success = true;
        } catch {
            success = false;
        }
        require(!success, "Non-whitelisted user should not be able to transfer when paused");
        
        // Now whitelist user1 for _transfer function
        (didExecute, ret) = adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(adminToken), "_transfer", address(user1));
        require(didExecute, "Failed to add whitelist");
        
        // Now user1 should be able to transfer when paused
        success = false;
        try user1.do(address(adminToken), "transfer(address,uint256)", address(user2), transferAmount) {
            success = true;
        } catch {
            success = false;
        }
        require(success, "Whitelisted user1 should be able to transfer when paused");
        
        // Approve user2 to spend user1's tokens
        user1.do(address(adminToken), "approve(address,uint256)", address(user2), transferAmount);

        // Now whitelist user1 for _transfer function
        (didExecute, ret) = adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(adminToken), "_transfer", address(user2));
        require(didExecute, "Failed to add whitelist");

        // Try to have user2 transferFrom - should fail since token is paused
        success = false;
        try user2.do(address(adminToken), "transferFrom(address,address,uint256)", address(user1), address(user2), transferAmount) {
            success = true;
        } catch {
            success = false;
        }
        require(success, "Whitelisted user2 should be able to transferFrom when paused");
        
        // Verify the transfer actually happened
        uint256 user2Balance = ERC20(adminToken).balanceOf(address(user2));
        require(user2Balance == transferAmount * 2, "User2 should have received transfer amount");
    }
}
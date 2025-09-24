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

    Mercata m;
    Token token;
    User user1;
    User user2;

    function beforeAll() {
        // Create test users
        user1 = new User();
        user2 = new User();

        // Create full Mercata infrastructure
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() {
        // Deploy a fresh test token for each test
        address tokenAddress = m.tokenFactory().createToken(
            "Test Token",
            "Test token for pausable operations",
            [],
            [],
            [],
            "TEST",
            0, // Start with 0 supply like BaseCodeCollection test
            18
        );
        
        require(tokenAddress != address(0), "Token address is 0");
        token = Token(tokenAddress);
        
        // Mint some tokens to this test contract for testing
        token.mint(address(this), 1000000 * 10**18);
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
        
        // Try to transfer tokens - should fail
        uint256 transferAmount = 1000 * 10**18;
        bool success = false;
        try ERC20(token).transfer(address(user2), transferAmount) {
            success = true;
        } catch {
            success = false;
        }
        require(!success, "Transfer should fail when token is paused");
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
        
        // Try transferFrom - should fail
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

    function it_allows_allowList_users_to_transfer_when_paused() {
        // Give both users some tokens first
        uint256 initialAmount = 1000 * 10**18;
        ERC20(token).transfer(address(user1), initialAmount);
        ERC20(token).transfer(address(user2), initialAmount);

        // Create allow list with user1
        address[] memory allowList = new address[](1);
        allowList[0] = address(user1);

        // Pause with allow list
        token.pause'(allowList);

        // Check that user1 can transfer (they are on allow list)
        uint256 transferAmount = 100 * 10**18;
        bool user1Success = false;
        try user1.do(address(token), "transfer(address,uint256)", address(this), transferAmount) {
            user1Success = true;
        } catch {
            user1Success = false;
        }
        require(user1Success, "User1 should be able to transfer when on allow list");

        // Check that user2 cannot transfer (they are NOT on allow list)
        bool user2Success = false;
        try user2.do(address(token), "transfer(address,uint256)", address(this), transferAmount) {
            user2Success = true;
        } catch {
            user2Success = false;
        }
        require(!user2Success, "User2 should NOT be able to transfer when not on allow list");

        // Unpause
        token.unpause();

        // Check that both users can transfer after unpause
        user1Success = false;
        try user1.do(address(token), "transfer(address,uint256)", address(this), transferAmount) {
            user1Success = true;
        } catch {
            user1Success = false;
        }
        require(user1Success, "User1 should be able to transfer after unpause");

        user2Success = false;
        try user2.do(address(token), "transfer(address,uint256)", address(this), transferAmount) {
            user2Success = true;
        } catch {
            user2Success = false;
        }
        require(user2Success, "User2 should be able to transfer after unpause");
    }
}
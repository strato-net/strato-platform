// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Tokens/Token.sol";
import "../../concrete/Tokens/TokenFactory.sol";

contract Describe_Token {
    Token token;
    TokenFactory factory;
    address user1;
    address user2;
    address owner;

    function beforeAll() {
        owner = address(this);
        factory = new TokenFactory(owner);
        user1 = address(0x1);
        user2 = address(0x2);
    }

    function beforeEach() {
        address tokenAddress = factory.createTokenWithInitialOwner(
            "Test Token",
            "Test Description",
            new string[](0),
            new string[](0),
            new string[](0),
            "TEST",
            1000000e18,
            18,
            owner
        );
        token = Token(tokenAddress);
    }

    function it_token_can_mint_tokens() {
        uint256 mintAmount = 1000e18;
        token.mint(user1, mintAmount);
        require(ERC20(token).balanceOf(user1) == mintAmount, "Mint should update balance");
        require(ERC20(token).totalSupply() == 1000000e18 + mintAmount, "Mint should update total supply");
    }

    function it_token_can_burn_tokens() {
        uint256 burnAmount = 1000e18;
        token.burn(owner, burnAmount);
        require(ERC20(token).balanceOf(owner) == 1000000e18 - burnAmount, "Burn should update balance");
        require(ERC20(token).totalSupply() == 1000000e18 - burnAmount, "Burn should update total supply");
    }

    function it_token_can_mint_to_multiple_addresses() {
        uint256 mintAmount1 = 500e18;
        uint256 mintAmount2 = 750e18;

        token.mint(user1, mintAmount1);
        token.mint(user2, mintAmount2);

        require(ERC20(token).balanceOf(user1) == mintAmount1, "User1 balance not updated");
        require(ERC20(token).balanceOf(user2) == mintAmount2, "User2 balance not updated");
        require(ERC20(token).totalSupply() == 1000000e18 + mintAmount1 + mintAmount2, "Total supply not updated");
    }

    function it_token_can_set_status_to_legacy() {
        token.setStatus(3);
        require(uint(token.status()) == 3, "Status should be LEGACY (3)");
    }

    function it_token_can_change_status_multiple_times() {
        token.setStatus(2);
        require(uint(token.status()) == 2, "First status change failed");

        token.setStatus(3);
        require(uint(token.status()) == 3, "Second status change failed");

        token.setStatus(2);
        require(uint(token.status()) == 2, "Third status change failed");
    }

    function it_token_handles_zero_amount_operations() {
        token.mint(user1, 0);
        require(ERC20(token).balanceOf(user1) == 0, "Zero amount mint should work");

        token.burn(owner, 0);
        require(ERC20(token).balanceOf(owner) == 1000000e18, "Zero amount burn should work");
    }

    function it_token_handles_large_amounts() {
        uint256 largeAmount = 1000000e18; // Same as initial supply
        token.mint(user1, largeAmount);
        require(ERC20(token).balanceOf(user1) == largeAmount, "Large amount mint should work");
        require(ERC20(token).totalSupply() == 2000000e18, "Large amount should update total supply");
    }

    function it_token_handles_status_changes_with_operations() {
        // Start with PENDING
        require(uint(token.status()) == 1, "Should start with PENDING status");

        // Change to ACTIVE and perform operations
        token.setStatus(2);
        token.mint(user1, 1000e18);
        require(uint(token.status()) == 2, "Should remain ACTIVE after operations");

        // Change to LEGACY
        token.setStatus(3);
        require(uint(token.status()) == 3, "Should be LEGACY");
    }

    // ============ TOKEN-SPECIFIC FACTORY INTEGRATION ============

    function it_token_has_correct_token_factory() {
        require(address(token.tokenFactory()) == address(factory), "Token factory not set correctly");
    }

    // Note: Token factory can only be set by the current factory, not by the owner
    // These tests are covered in TokenFactory.test.sol

    // ============ TOKEN-SPECIFIC METADATA INTEGRATION ============

    function it_token_can_set_metadata() {
        string[] memory images = new string[](2);
        images[0] = "https://example.com/image1.jpg";
        images[1] = "https://example.com/image2.png";

        string[] memory files = new string[](2);
        files[0] = "https://example.com/file1.pdf";
        files[1] = "https://example.com/file2.txt";

        string[] memory fileNames = new string[](2);
        fileNames[0] = "Document1.pdf";
        fileNames[1] = "Document2.txt";

        token.setMetadata("Updated Description", images, files, fileNames);
        // Note: Description is not public, so we can't verify it directly
    }

    function it_token_can_set_attributes() {
        token.setAttribute("category", "utility");
        token.setAttribute("version", "2.0");
        token.setAttribute("network", "mainnet");

        require(keccak256(TokenMetadata(token).attributes("category")) == keccak256("utility"), "Category attribute not set");
        require(keccak256(TokenMetadata(token).attributes("version")) == keccak256("2.0"), "Version attribute not set");
        require(keccak256(TokenMetadata(token).attributes("network")) == keccak256("mainnet"), "Network attribute not set");
    }

    function it_token_can_update_attributes() {
        token.setAttribute("version", "1.0");
        require(keccak256(TokenMetadata(token).attributes("version")) == keccak256("1.0"), "Initial version not set");

        token.setAttribute("version", "2.0");
        require(keccak256(TokenMetadata(token).attributes("version")) == keccak256("2.0"), "Version not updated");
    }

    function it_token_can_update_name_and_symbol() {
        token.setNameAndSymbol("New Name", "NEW");
        require(keccak256(ERC20(token).name()) == keccak256("New Name"), "Name not updated");
        require(keccak256(ERC20(token).symbol()) == keccak256("NEW"), "Symbol not updated");
    }

    // ============ TOKEN-SPECIFIC EDGE CASES ============

    function it_token_handles_rapid_status_changes() {
        for (uint i = 0; i < 10; i++) {
            token.setStatus(2);
            require(uint(token.status()) == 2, "Status should be ACTIVE");
            token.setStatus(3);
            require(uint(token.status()) == 3, "Status should be LEGACY");
        }
    }

    function it_token_handles_rapid_minting_and_burning() {
        for (uint i = 0; i < 5; i++) {
            token.mint(user1, 100e18);
            token.burn(owner, 100e18);
        }
        require(ERC20(token).balanceOf(user1) == 500e18, "User balance not correct after rapid operations");
        require(ERC20(token).balanceOf(owner) == 1000000e18 - 500e18, "Owner balance not correct after rapid operations");
    }

    function it_token_handles_maximum_status_value() {
        token.setStatus(3); // LEGACY is the highest status
        require(uint(token.status()) == 3, "Should handle maximum status value");
    }

    function it_token_handles_status_cycling() {
        // Start with PENDING (1), cycle through statuses
        require(uint(token.status()) == 1, "Should start with PENDING");

        token.setStatus(2); // ACTIVE
        require(uint(token.status()) == 2, "Should be ACTIVE");

        token.setStatus(3); // LEGACY
        require(uint(token.status()) == 3, "Should be LEGACY");

        token.setStatus(2); // Back to ACTIVE
        require(uint(token.status()) == 2, "Should be ACTIVE again");

        token.setStatus(1); // Back to PENDING
        require(uint(token.status()) == 1, "Should be PENDING again");
    }

    // ============ TOKEN LIFECYCLE INTEGRATION ============

    function it_token_handles_complete_lifecycle() {
        // 1. Initial state
        require(uint(token.status()) == 1, "Should start with PENDING status");
        require(ERC20(token).totalSupply() == 1000000e18, "Should have initial supply");

        // 2. Activate token
        token.setStatus(2);
        require(uint(token.status()) == 2, "Should be ACTIVE");

        // 3. Perform operations
        token.mint(user1, 1000e18);
        token.mint(user2, 2000e18);
        token.burn(owner, 500e18);

        require(ERC20(token).balanceOf(user1) == 1000e18, "User1 should have minted tokens");
        require(ERC20(token).balanceOf(user2) == 2000e18, "User2 should have minted tokens");
        require(ERC20(token).balanceOf(owner) == 1000000e18 - 500e18, "Owner should have burned tokens");
        require(ERC20(token).totalSupply() == 1000000e18 + 3000e18 - 500e18, "Total supply should be updated");

        // 4. Update metadata
        string[] memory images = new string[](1);
        images[0] = "https://example.com/image.jpg";
        string[] memory files = new string[](1);
        files[0] = "https://example.com/file.pdf";
        string[] memory fileNames = new string[](1);
        fileNames[0] = "Document.pdf";

        token.setMetadata("Updated Description", images, files, fileNames);
        token.setAttribute("category", "utility");
        token.setAttribute("version", "2.0");

        // 5. Migrate to legacy
        token.setStatus(3);
        require(uint(token.status()) == 3, "Should be LEGACY");
    }
}
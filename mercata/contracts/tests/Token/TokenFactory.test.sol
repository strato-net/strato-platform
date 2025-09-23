// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Tokens/TokenFactory.sol";
import "../../concrete/Tokens/Token.sol";

contract Describe_TokenFactory {
    TokenFactory factory;
    address owner;
    address user1;
    address user2;
    string[] emptyArray;

    function beforeAll() {
        owner = address(this);
        user1 = address(0x1);
        user2 = address(0x2);
        emptyArray = new string[](0);
    }

    function beforeEach() {
        factory = new TokenFactory(owner);
    }

    // ============ BASIC FACTORY PROPERTIES ============

    function it_factory_creates_successfully() {
        require(address(factory) != address(0), "Factory should be created");
    }

    function it_factory_has_correct_owner() {
        require(Ownable(factory).owner() == owner, "Factory owner not set correctly");
    }

    function it_factory_starts_with_empty_token_list() {
        require(factory.allTokens().length == 0, "Factory should start with empty token list");
    }

    // ============ TOKEN CREATION ============

    function it_factory_can_create_token() {
        address tokenAddress = factory.createToken(
            "Test Token",
            "Test Description",
            emptyArray,
            emptyArray,
            emptyArray,
            "TEST",
            1000000e18,
            18
        );
        
        require(tokenAddress != address(0), "Token should be created");
        require(factory.isFactoryToken(tokenAddress), "Token should be registered as factory token");
        require(factory.allTokens().length == 1, "Token should be added to allTokens array");
    }

    function it_factory_can_create_token_with_initial_owner() {
        address tokenAddress = factory.createTokenWithInitialOwner(
            "Test Token",
            "Test Description",
            emptyArray,
            emptyArray,
            emptyArray,
            "TEST",
            1000000e18,
            18,
            user1
        );
        
        require(tokenAddress != address(0), "Token should be created");
        require(factory.isFactoryToken(tokenAddress), "Token should be registered as factory token");
        require(Ownable(tokenAddress).owner() == user1, "Token should have correct initial owner");
    }

    function it_factory_can_create_multiple_tokens() {
        address token1 = factory.createToken(
            "Token 1",
            "Description 1",
            emptyArray,
            emptyArray,
            emptyArray,
            "TK1",
            1000e18,
            18
        );
        
        address token2 = factory.createToken(
            "Token 2",
            "Description 2",
            emptyArray,
            emptyArray,
            emptyArray,
            "TK2",
            2000e18,
            18
        );
        
        require(factory.allTokens().length == 2, "Should have 2 tokens");
        require(factory.isFactoryToken(token1), "Token 1 should be registered");
        require(factory.isFactoryToken(token2), "Token 2 should be registered");
    }

    function it_factory_creates_tokens_with_correct_properties() {
        address tokenAddress = factory.createToken(
            "My Token",
            "My Description",
            emptyArray,
            emptyArray,
            emptyArray,
            "MTK",
            5000000e18,
            6
        );
        
        Token token = Token(tokenAddress);
        require(keccak256(ERC20(token).name()) == keccak256("My Token"), "Token name not set correctly");
        require(keccak256(ERC20(token).symbol()) == keccak256("MTK"), "Token symbol not set correctly");
        require(token.decimals() == 6, "Token decimals not set correctly");
        require(ERC20(token).totalSupply() == 5000000e18, "Token total supply not set correctly");
    }

    // ============ TOKEN VALIDATION ============

    function it_factory_can_check_token_status() {
        address tokenAddress = factory.createToken(
            "Test Token",
            "Test Description",
            emptyArray,
            emptyArray,
            emptyArray,
            "TEST",
            1000000e18,
            18
        );
        
        Token token = Token(tokenAddress);
        require(!factory.isTokenActive(tokenAddress), "New token should not be active (PENDING status)");
        
        token.setStatus(2); // ACTIVE
        require(factory.isTokenActive(tokenAddress), "Token should be active after status change");
        
        token.setStatus(3); // LEGACY
        require(!factory.isTokenActive(tokenAddress), "Token should not be active when LEGACY");
    }

    function it_factory_rejects_non_factory_tokens() {
        // Create a token outside the factory
        TokenFactory otherFactory = new TokenFactory(owner);
        address otherToken = otherFactory.createToken(
            "Other Token",
            "Other Description",
            emptyArray,
            emptyArray,
            emptyArray,
            "OTHER",
            1000000e18,
            18
        );
        
        require(!factory.isFactoryToken(otherToken), "Non-factory token should not be registered");
        require(!factory.isTokenActive(otherToken), "Non-factory token should not be considered active");
    }

    // ============ TOKEN MIGRATION ============

    function it_factory_can_migrate_tokens_to_new_factory() {
        // Create tokens
        address token1 = factory.createToken(
            "Token 1",
            "Description 1",
            emptyArray,
            emptyArray,
            emptyArray,
            "TK1",
            1000e18,
            18
        );
        
        address token2 = factory.createToken(
            "Token 2",
            "Description 2",
            emptyArray,
            emptyArray,
            emptyArray,
            "TK2",
            2000e18,
            18
        );
        
        // Create new factory
        TokenFactory newFactory = new TokenFactory(owner);
        
        // Migrate tokens
        factory.migrateTokensToFactory(address(newFactory));
        
        // Check that tokens now point to new factory
        require(address(Token(token1).tokenFactory()) == address(newFactory), "Token 1 should point to new factory");
        require(address(Token(token2).tokenFactory()) == address(newFactory), "Token 2 should point to new factory");
    }

    function it_factory_can_register_migrated_tokens() {
        // Create tokens in another factory
        TokenFactory otherFactory = new TokenFactory(owner);
        address token1 = otherFactory.createToken(
            "Token 1",
            "Description 1",
            emptyArray,
            emptyArray,
            emptyArray,
            "TK1",
            1000e18,
            18
        );
        
        address token2 = otherFactory.createToken(
            "Token 2",
            "Description 2",
            emptyArray,
            emptyArray,
            emptyArray,
            "TK2",
            2000e18,
            18
        );
        
        // Register migrated tokens
        address[] memory tokens = new address[](2);
        tokens[0] = token1;
        tokens[1] = token2;
        
        factory.registerMigratedTokens(tokens);
        
        require(factory.isFactoryToken(token1), "Token 1 should be registered");
        require(factory.isFactoryToken(token2), "Token 2 should be registered");
        require(factory.allTokens().length == 2, "Should have 2 tokens in allTokens array");
    }

    // ============ FACTORY EDGE CASES ============

    function it_factory_handles_empty_token_creation() {
        address tokenAddress = factory.createToken(
            "",
            "",
            emptyArray,
            emptyArray,
            emptyArray,
            "",
            0,
            0
        );
        
        require(tokenAddress != address(0), "Empty token should still be created");
        require(factory.isFactoryToken(tokenAddress), "Empty token should be registered");
    }

    function it_factory_handles_large_token_creation() {
        address tokenAddress = factory.createToken(
            "Large Token",
            "Large Description",
            emptyArray,
            emptyArray,
            emptyArray,
            "LARGE",
            1000000000e18, // 1 billion tokens
            18
        );
        
        require(tokenAddress != address(0), "Large token should be created");
        require(ERC20(tokenAddress).totalSupply() == 1000000000e18, "Large token should have correct supply");
    }

    function it_factory_handles_different_decimals() {
        address token6 = factory.createToken(
            "Token 6",
            "Description",
            emptyArray,
            emptyArray,
            emptyArray,
            "TK6",
            1000000e6,
            6
        );
        
        address token8 = factory.createToken(
            "Token 8",
            "Description",
            emptyArray,
            emptyArray,
            emptyArray,
            "TK8",
            1000000e8,
            8
        );
        
        require(Token(token6).decimals() == 6, "Token should have 6 decimals");
        require(Token(token8).decimals() == 8, "Token should have 8 decimals");
    }

    function it_factory_handles_rapid_token_creation() {
        for (uint i = 0; i < 5; i++) {
            factory.createToken(
                "Rapid Token",
                "Rapid Description",
                emptyArray,
                emptyArray,
                emptyArray,
                "RAPID",
                1000e18,
                18
            );
        }
        
        require(factory.allTokens().length == 5, "Should have created 5 tokens");
    }

    // ============ FACTORY INTEGRATION ============

    function it_factory_handles_complete_workflow() {
        // 1. Create multiple tokens
        address token1 = factory.createToken(
            "Workflow Token 1",
            "Description 1",
            emptyArray,
            emptyArray,
            emptyArray,
            "WF1",
            1000e18,
            18
        );
        
        address token2 = factory.createTokenWithInitialOwner(
            "Workflow Token 2",
            "Description 2",
            emptyArray,
            emptyArray,
            emptyArray,
            "WF2",
            2000e18,
            18,
            owner
        );
        
        // 2. Verify tokens are registered
        require(factory.allTokens().length == 2, "Should have 2 tokens");
        require(factory.isFactoryToken(token1), "Token 1 should be registered");
        require(factory.isFactoryToken(token2), "Token 2 should be registered");
        
        // 3. Activate tokens
        Token(token1).setStatus(2); // ACTIVE
        Token(token2).setStatus(2); // ACTIVE
        
        // 4. Verify active status
        require(factory.isTokenActive(token1), "Token 1 should be active");
        require(factory.isTokenActive(token2), "Token 2 should be active");
        
        // 5. Create new factory and migrate
        TokenFactory newFactory = new TokenFactory(owner);
        factory.migrateTokensToFactory(address(newFactory));
        
        // 6. Verify migration
        require(address(Token(token1).tokenFactory()) == address(newFactory), "Token 1 should be migrated");
        require(address(Token(token2).tokenFactory()) == address(newFactory), "Token 2 should be migrated");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./Pool.sol";

/**
 * @title Pool Factory
 * @notice Creates and manages Uniswap-style liquidity pools
 * @dev Creates new pool instances and maintains registry of token to pool mappings
 */
contract Factory {
    address public exchangeTemplate;
    uint256 public tokenCount;
    
    // Mappings to track pools and tokens
    mapping(address => address) public tokenToExchange;
    mapping(address => address) public exchangeToToken;
    mapping(uint256 => address) public idToToken;
    
    // Events
    event NewExchange(address indexed token, address indexed exchange);
    
    /**
     * @notice Initialize the factory with the exchange template
     * @param template Address of the exchange/pool implementation to clone
     */
    function initializeFactory(address template) external {
        require(exchangeTemplate == address(0), "Factory already initialized");
        require(template != address(0), "Invalid template address");
        exchangeTemplate = template;
    }
    
    /**
     * @notice Create a new exchange for a token
     * @param token Address of the ERC20 token
     * @return Address of the new exchange
     */
    function createExchange(address token) external returns (address) {
        require(token != address(0), "Invalid token address");
        require(exchangeTemplate != address(0), "Factory not initialized");
        require(tokenToExchange[token] == address(0), "Exchange already exists");
        
        // Create a new pool instance
        bytes memory bytecode = type(Pool).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token));
        address exchange;
        
        assembly {
            exchange := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        
        // Initialize the new pool
        Pool(exchange).setup(token);
        
        // Update registry
        tokenToExchange[token] = exchange;
        exchangeToToken[exchange] = token;
        
        uint256 tokenId = tokenCount + 1;
        tokenCount = tokenId;
        idToToken[tokenId] = token;
        
        emit NewExchange(token, exchange);
        return exchange;
    }
    
    /**
     * @notice Get the exchange address for a token
     * @param token Address of the ERC20 token
     * @return Address of the corresponding exchange
     */
    function getExchange(address token) external view returns (address) {
        return tokenToExchange[token];
    }
    
    /**
     * @notice Get the token address for an exchange
     * @param exchange Address of the exchange
     * @return Address of the corresponding token
     */
    function getToken(address exchange) external view returns (address) {
        return exchangeToToken[exchange];
    }
    
    /**
     * @notice Get token address by its ID
     * @param tokenId ID of the token
     * @return Address of the token
     */
    function getTokenWithId(uint256 tokenId) external view returns (address) {
        return idToToken[tokenId];
    }
}

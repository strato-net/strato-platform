/**
 * @title TokenFactory
 * @notice Factory pattern contract that standardizes token creation and tracking
 * @dev While tokens are created here, users interact directly with token contracts after creation
 *
 * The factory serves three main purposes:
 * 1. Standardized token creation (owner or admin only)
 * 2. Token registry - track all tokens created by this factory
 * 3. Token validation - verify tokens are active and belong to this factory
 */

// SPDX-License-Identifier: MIT
import "./Token.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../Proxy/Proxy.sol";

/// @notice Token factory contract
contract record TokenFactory is Ownable {
    
    // ============ EVENTS ============
    
    /// @notice Event emitted when a new token is created
    event TokenCreated(address token, address creator, string name, string symbol);

    /// @notice Event emitted when tokens are migrated
    event TokensMigrated(address oldFactory, address newFactory, uint256 tokenCount);

    /// @notice Event emitted when tokens are registered
    event TokensRegistered(uint256 tokenCount);

    // ============ STATE VARIABLES ============
    
    /// @notice Mapping of token addresses to factory token status
    mapping(address => bool) public isFactoryToken;
    
    /// @notice Array of all token addresses
    address[] public record allTokens;
    
    // ============ CONSTRUCTOR ============
    
    /// @notice Constructor
    /// @param initialOwner The initial owner of the contract
    constructor(address initialOwner) Ownable(initialOwner) {
    }

    // ============ TOKEN MANAGEMENT ============
    
    /// @notice Create a new token
    /// @param _name Token name
    /// @param _description Token description
    /// @param _images Array of image URLs
    /// @param _files Array of file URLs
    /// @param _fileNames Array of file names
    /// @param _symbol Token symbol
    /// @param _initialSupply Initial token supply
    /// @param _customDecimals Token decimals
    /// @return Address of the created token
    function createToken(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        string _symbol,
        uint256 _initialSupply,
        uint8 _customDecimals
    ) external onlyOwner returns (address) {
        return createTokenWithInitialOwner(
            _name,
            _description,
            _images,
            _files,
            _fileNames,
            _symbol,
            _initialSupply,
            _customDecimals,
            msg.sender
        );
    }

    function createTokenWithInitialOwner(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        string _symbol,
        uint256 _initialSupply,
        uint8 _customDecimals,
        address _initialOwner
    ) public onlyOwner returns (address) {
        // Create new token with msg.sender as the token creator
        Token newToken = Token(address(new Proxy(address(new Token(_initialOwner)), address(this))));
        newToken.initialize(
            _name,
            _description,
            _images,
            _files,
            _fileNames,
            _symbol,
            _initialSupply,
            _customDecimals,
            _initialOwner
        );
        newToken.transferOwnership(_initialOwner);
        
        // Register the token
        address tokenAddress = address(newToken);
        isFactoryToken[tokenAddress] = true;
        allTokens.push(tokenAddress);
        
        emit TokenCreated(tokenAddress, msg.sender, _name, _symbol);
        return tokenAddress;
    }

    /// @notice Check if a token is active and belongs to this factory
    /// @param token Token address to check
    /// @return True if token is active and belongs to this factory
    function isTokenActive(address token) external view returns (bool) {
        return Token(token).status() == TokenStatus.ACTIVE && isFactoryToken[token];
    }

    /// @notice Migrate tokens to a new factory
    /// @param newFactory Address of the new factory
    function migrateTokensToFactory(address newFactory) external onlyOwner {
        for (uint256 i = 0; i < allTokens.length; i++) {
            address tokenAddr = allTokens[i];
            Token(tokenAddr).setTokenFactory(newFactory);
        }
        emit TokensMigrated(address(this), newFactory, allTokens.length);
    }

    /// @notice Register tokens that were migrated from another factory
    /// @param tokens Array of token addresses to register
    function registerMigratedTokens(address[] tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            isFactoryToken[tokens[i]] = true;
            allTokens.push(tokens[i]);
        }
        emit TokensRegistered(tokens.length);
    }
}
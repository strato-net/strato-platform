// SPDX-License-Identifier: MIT
import "./Token.sol";

contract record TokenFactory is Ownable {
    event TokenCreated(address token, address creator, string name, string symbol);
    event TokenStatusChanged(address token, TokenStatus oldStatus, TokenStatus newStatus);
    event TokenMigrated(address token, address oldFactory, address newFactory);
    
    // Mapping to track all tokens created by this factory
    mapping(address => bool) public record tokens;
    
    constructor(address initialOwner) Ownable(initialOwner) {}
    
    function createToken(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        string _symbol,
        uint256 _initialSupply,
        uint8 _customDecimals
    ) external returns (address) {
        // Create new token with msg.sender as the token creator
        Token newToken = new Token(
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
        
        // Register the token
        address tokenAddress = address(newToken);
        tokens[tokenAddress] = true;
        
        emit TokenCreated(tokenAddress, msg.sender, _name, _symbol);
        return tokenAddress;
    }
    
    function setTokenStatus(address token, TokenStatus newStatus) external onlyOwner {
        require(tokens[token], "TokenFactory: token not created by this factory");
        TokenStatus oldStatus = Token(token).status();
        Token(token).setStatus(newStatus);
        emit TokenStatusChanged(token, oldStatus, newStatus);
    }

    function migrateToken(address token, address oldFactory) external onlyOwner {
        require(token != address(0), "TokenFactory: zero address");
        require(oldFactory != address(0), "TokenFactory: zero factory address");
        require(!tokens[token], "TokenFactory: token already registered");
        
        // Verify the token was created by the old factory
        require(TokenFactory(oldFactory).tokens(token), "TokenFactory: token not from old factory");
        
        // Register the token in this factory
        tokens[token] = true;
        
        emit TokenMigrated(token, oldFactory, address(this));
    }
} 
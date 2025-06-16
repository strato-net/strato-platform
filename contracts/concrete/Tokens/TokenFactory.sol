// SPDX-License-Identifier: MIT
import "./Token.sol";

contract record TokenFactory is Ownable {
    mapping(address => bool) public isFactoryToken;

    event TokenCreated(address token, address creator, string name, string symbol);
    
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
    ) external onlyOwner returns (address) {
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
        isFactoryToken[address(newToken)] = true;
        
        emit TokenCreated(tokenAddress, msg.sender, _name, _symbol);
        return tokenAddress;
    }
    
    function setTokenStatus(address token, uint newStatus) external onlyOwner {
        Token(token).setStatus(newStatus);
    }

    function isTokenActive(address token) external view returns (bool) {
        return Token(token).status() == TokenStatus.ACTIVE && isFactoryToken[token];
    }

    function migrateTokensToFactory(address newFactory, address[] tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            address tokenAddr = tokens[i];
            Token(tokenAddr).setTokenFactory(newFactory);
        }
    }

    function registerMigratedTokens(address[] tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            isFactoryToken[tokens[i]] = true;
        }
    }
}
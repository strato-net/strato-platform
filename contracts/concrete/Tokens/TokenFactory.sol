// SPDX-License-Identifier: MIT
import "./Token.sol";

contract record TokenFactory is Ownable {
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
        
        emit TokenCreated(tokenAddress, msg.sender, _name, _symbol);
        return tokenAddress;
    }
    
    function setTokenStatus(address token, TokenStatus newStatus) external onlyOwner {
        TokenStatus oldStatus = Token(token).status();
        Token(token).setStatus(newStatus);
    }
} 
// SPDX-License-Identifier: MIT
import "./Token.sol";
import "../Admin/AdminRegistry.sol";

contract record TokenFactory is Ownable {
    mapping(address => bool) public isFactoryToken;
    address[] public record allTokens;
    AdminRegistry public adminRegistry;

    event TokenCreated(address token, address creator, string name, string symbol);
    event AdminRegistryUpdated(address oldRegistry, address newRegistry);
    event TokensMigrated(address oldFactory, address newFactory, uint256 tokenCount);
    event TokensRegistered(uint256 tokenCount);

    constructor(address initialOwner, address _adminRegistry) Ownable(initialOwner) {
        require(_adminRegistry != address(0), "Zero admin registry address");
        adminRegistry = AdminRegistry(_adminRegistry);
    }
    
    modifier onlyOwnerOrAdmin() {
        require(msg.sender == owner() || adminRegistry.isAdminAddress(msg.sender), "TokenFactory: caller is not owner or admin");
        _;
    }
    
    function createToken(
        string _name,
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames,
        string _symbol,
        uint256 _initialSupply,
        uint8 _customDecimals
    ) external onlyOwnerOrAdmin returns (address) {
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
        allTokens.push(tokenAddress);
        
        emit TokenCreated(tokenAddress, msg.sender, _name, _symbol);
        return tokenAddress;
    }

    function isTokenActive(address token) external view returns (bool) {
        return Token(token).status() == TokenStatus.ACTIVE && isFactoryToken[token];
    }
    
    function setTokenStatus(address token, uint newStatus) external onlyOwnerOrAdmin {
        Token(token).setStatus(newStatus);
    }

    function setAdminRegistry(address _adminRegistry) external onlyOwner {
        require(_adminRegistry != address(0), "Zero admin registry address");
        address oldRegistry = address(adminRegistry);
        adminRegistry = AdminRegistry(_adminRegistry);
        emit AdminRegistryUpdated(oldRegistry, _adminRegistry);
    }

    function migrateTokensToFactory(address newFactory) external onlyOwnerOrAdmin {
        for (uint256 i = 0; i < allTokens.length; i++) {
            address tokenAddr = allTokens[i];
            Token(tokenAddr).setTokenFactory(newFactory);
        }
        emit TokensMigrated(address(this), newFactory, allTokens.length);
    }

    function registerMigratedTokens(address[] tokens) external onlyOwnerOrAdmin {
        for (uint256 i = 0; i < tokens.length; i++) {
            isFactoryToken[tokens[i]] = true;
            allTokens.push(tokens[i]);
        }
        emit TokensRegistered(tokens.length);
    }
}
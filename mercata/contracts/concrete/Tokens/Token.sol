import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/utils/Pausable.sol";
import "../Admin/AdminRegistry.sol";
import "./TokenMetadata.sol";
import "./TokenFactory.sol";

/**
 * FYI: IMPORTANT NOTICE FOR ERC20 REIMPLEMENTATION
 *
 * Anyone planning to modify this Token contract or reimplement ERC20 functionality should read this:
 *
 * 1. This Token contract inherits from ERC20 (../../abstract/ERC20.sol), which is a copy of
 *    OpenZeppelin's ERC20 implementation with some modifications.
 *
 * 2. CRITICAL BEHAVIOR: The current ERC20.sol implementation deviates from the ERC20 standard
 *    in that transfer() and transferFrom() functions ALWAYS REVERT on invalid states
 *    (e.g., insufficient funds) instead of returning false as specified in the ERC20 standard.
 *    This means these functions will either:
 *    - Return true (success), OR
 *    - Throw/revert (failure)
 *    They will NEVER return false.
 *
 * 3. OpenZeppelin's reference implementation follows the same pattern (revert on failure).
 *
 * 4. DEPENDENCY: Other contracts in this codebase leverage this "revert-on-failure" behavior.
 *    They call transfer()/transferFrom() and assume the call will either succeed or revert,
 *    without checking the return value in many cases.
 *
 * 5. BREAKING CHANGE WARNING: If you replace ERC20.sol with an implementation that returns
 *    false on failure (instead of reverting), this will break other contracts that depend
 *    on the current behavior. Many contracts will silently accept failed transfers as successful.
 *
 * 6. Consider this dependency whenever modifying ERC20.sol or Token.sol. Any changes to the
 *    error handling behavior must be coordinated with updates to all dependent contracts.
 */

enum TokenStatus { NULL, PENDING, ACTIVE, LEGACY }

contract record Token is ERC20, Ownable, TokenMetadata, Pausable {
    uint8 public customDecimals;
    TokenStatus public status;
    TokenFactory public tokenFactory;

    event StatusChanged(TokenStatus newStatus);

    modifier onlyTokenFactory() {
        require(msg.sender == address(tokenFactory), "Token: caller is not token factory");
        _;
    }

    modifier whenNotPausedOrOwner() {
        if (paused()) {
            try {
                _checkOwner();
            } catch {
                AdminRegistry admin = AdminRegistry(Ownable(tokenFactory).owner());
                require(admin.whitelist(address(this), msg.sig, _msgSender()), "not whitelisted");
            }
        }
        _;
    }

    constructor(address initialOwner)
        Ownable(initialOwner)
        ERC20("", "")
        TokenMetadata("", [], [], [])
    {}

    function initialize(
        string name_,
        string description_,
        string[] images_,
        string[] files_,
        string[] fileNames_,
        string symbol_,
        uint256 initialSupply_,
        uint8 customDecimals_,
        address tokenCreator_
    ) external onlyOwner {

        // ERC20(name_, symbol_)
        _name = name_;
        _symbol = symbol_;

        // TokenMetadata(description_, images_, files_, fileNames_)
        _setMetadata(description_, images_, files_, fileNames_);

        customDecimals = customDecimals_;
        status = TokenStatus.PENDING;
        tokenFactory = TokenFactory(msg.sender);
        _mint(tokenCreator_, initialSupply_);

        emit StatusChanged(status);
    }

    function setStatus(uint newStatus) external onlyOwner {
        require(newStatus != uint(status), "Token: New status is the same as the current status");
        require(newStatus != uint(TokenStatus.NULL), "Token: New status is NULL");
        TokenStatus _newStatus = TokenStatus(newStatus);
        status = _newStatus;

        emit StatusChanged(status);
    }

    function setTokenFactory(address _tokenFactory) external onlyTokenFactory {
        tokenFactory = TokenFactory(_tokenFactory);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function addWhitelist(address _admin, string _func, address _accountToWhitelsit) external onlyOwner {
        AdminRegistry(_admin).castVoteOnIssue(_admin, "addWhitelist", this, _func, _accountToWhitelsit);
    }

    function setMetadata (
        string _description,
        string[] _images,
        string[] _files,
        string[] _fileNames
    ) external onlyOwner {
        _setMetadata(_description, _images, _files, _fileNames);
    }

    function setAttribute(string key, string value) external onlyOwner {
        _setAttribute(key, value);
    }

    function decimals() external view virtual override returns (uint8) {
        return customDecimals;
    }

    function transfer(address to, uint256 value) public override whenNotPausedOrOwner returns (bool) {
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override whenNotPausedOrOwner returns (bool) {
        return super.transferFrom(from, to, value);
    }
}
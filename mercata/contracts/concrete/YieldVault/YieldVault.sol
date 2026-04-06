// SPDX-License-Identifier: MIT
import "../../abstract/ERC4626/ERC4626.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/utils/Pausable.sol";
import "../Admin/AdminRegistry.sol";

/// @title YieldVault
/// @notice Minimal ERC-4626 vault for accepting deposits. Capital management
///         functions (deployCapital, returnCapital, reportStrategyGain/Loss)
///         will be added via contract upgrade once the yield pipeline is ready.
///         The `deployedAssets` slot is reserved so the upgrade is storage-compatible.
contract record YieldVault is ERC4626, Ownable, Pausable {
    /// @dev Reserved for future capital management — always 0 in this version.
    uint256 public deployedAssets;
    bool public vaultInitialized;

    event VaultInitialized(address indexed asset, string name, string symbol);

    modifier onlyOwner() {
        try {
            _checkOwner();
        } catch {
            address myOwner = owner();
            AdminRegistry admin = AdminRegistry(myOwner);
            address sender = _msgSender();
            if (myOwner == this) {
                sender = this;
            }
            (bool didExecute, variadic ret) = admin.castVoteOnIssue(sender, msg.sig, msg.data);
            return ret;
        }
        _;
    }

    constructor(address initialOwner)
        Ownable(initialOwner)
        ERC4626(address(0))
    {}

    function initialize(
        address asset_,
        string name_,
        string symbol_
    ) external onlyOwner {
        require(!vaultInitialized, "YieldVault: already initialized");
        require(asset_ != address(0), "YieldVault: asset=0");
        require(asset_ != address(this), "YieldVault: invalid asset");

        __ERC20_init(name_, symbol_);
        __ERC4626_init(asset_);
        vaultInitialized = true;

        emit VaultInitialized(asset_, name_, symbol_);
    }

    // ─── ERC-4626 Overrides ─────────────────────────────────────────────

    function totalAssets() public view override returns (uint256) {
        if (!vaultInitialized) return 0;
        return IERC20(asset()).balanceOf(address(this)) + deployedAssets;
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        if (!vaultInitialized || paused()) return 0;
        return super.maxDeposit(receiver);
    }

    function maxMint(address receiver) public view override returns (uint256) {
        if (!vaultInitialized || paused()) return 0;
        return super.maxMint(receiver);
    }

    function maxWithdraw(address ownerAddr) public view override returns (uint256) {
        if (!vaultInitialized || paused()) return 0;
        uint256 ownerMax = _convertToAssets(balanceOf(ownerAddr), false);
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        return ownerMax < idle ? ownerMax : idle;
    }

    function maxRedeem(address ownerAddr) public view override returns (uint256) {
        if (!vaultInitialized || paused()) return 0;
        uint256 ownerShares = balanceOf(ownerAddr);
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 idleShares = _convertToShares(idle, false);
        return ownerShares < idleShares ? ownerShares : idleShares;
    }

    function deposit(uint256 assets, address receiver) public override whenNotPaused returns (uint256) {
        _requireInitialized();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override whenNotPaused returns (uint256) {
        _requireInitialized();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address ownerAddr) public override whenNotPaused returns (uint256) {
        _requireInitialized();
        return super.withdraw(assets, receiver, ownerAddr);
    }

    function redeem(uint256 shares, address receiver, address ownerAddr) public override whenNotPaused returns (uint256) {
        _requireInitialized();
        return super.redeem(shares, receiver, ownerAddr);
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── View Helpers ───────────────────────────────────────────────────

    function exchangeRate() external view returns (uint256) {
        _requireInitialized();
        if (totalSupply() == 0) return 1e18;
        return (totalAssets() * 1e18) / totalSupply();
    }

    function _requireInitialized() internal view {
        require(vaultInitialized, "YieldVault: not initialized");
    }
}

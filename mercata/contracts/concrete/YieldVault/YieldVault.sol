import "../../abstract/ERC4626/ERC4626.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/utils/Pausable.sol";
import "../Admin/AdminRegistry.sol";

/// @title YieldVault
/// @notice ERC-4626 vault for yield optimization. Depositors hold shares representing
///         a claim on the underlying asset. An admin-whitelisted operator deploys idle
///         assets into yield strategies (e.g. CDP leveraged loop via syrupUSDC) and
///         reports gains/losses, causing the share price to move.
contract record YieldVault is ERC4626, Ownable, Pausable {
    uint256 public deployedAssets;
    bool public vaultInitialized;

    event VaultInitialized(address indexed asset, string name, string symbol);
    event CapitalDeployed(address indexed to, uint256 assets, uint256 totalDeployed);
    event CapitalReturned(address indexed from, uint256 assets, uint256 totalDeployed);
    event StrategyGainReported(uint256 profit, uint256 newTotalAssets);
    event StrategyLossReported(uint256 loss, uint256 newTotalAssets);

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
        deployedAssets = 0;

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

    // NOTE: ERC4626 recommends overriding _deposit/_withdraw (internal) rather
    //       than public functions, to keep deposit/mint and withdraw/redeem
    //       consistent. However, SolidVM resolves virtual calls inside super.fn()
    //       against the base contract, not the derived override. Since this
    //       contract overrides totalAssets(), calling super.deposit() would use
    //       the base totalAssets() (idle only, ignoring deployedAssets), producing
    //       incorrect share calculations. We inline the ERC4626 public logic here
    //       — each function mirrors the base exactly, calling preview* on `this`
    //       (correct dispatch) then delegating to _deposit/_withdraw (internal).

    function deposit(uint256 assets, address receiver) public override whenNotPaused returns (uint256) {
        _requireInitialized();
        require(assets <= maxDeposit(receiver), "ERC4626: deposit exceeds max");
        uint256 shares = previewDeposit(assets);
        _deposit(_msgSender(), receiver, assets, shares);
        return shares;
    }

    function mint(uint256 shares, address receiver) public override whenNotPaused returns (uint256) {
        _requireInitialized();
        require(shares <= maxMint(receiver), "ERC4626: mint exceeds max");
        uint256 assets = previewMint(shares);
        _deposit(_msgSender(), receiver, assets, shares);
        return assets;
    }

    function withdraw(uint256 assets, address receiver, address ownerAddr) public override whenNotPaused returns (uint256) {
        _requireInitialized();
        require(assets <= maxWithdraw(ownerAddr), "ERC4626: withdraw exceeds max");
        uint256 shares = previewWithdraw(assets);
        _withdraw(_msgSender(), receiver, ownerAddr, assets, shares);
        return shares;
    }

    function redeem(uint256 shares, address receiver, address ownerAddr) public override whenNotPaused returns (uint256) {
        _requireInitialized();
        require(shares <= maxRedeem(ownerAddr), "ERC4626: redeem exceeds max");
        uint256 assets = previewRedeem(shares);
        _withdraw(_msgSender(), receiver, ownerAddr, assets, shares);
        return assets;
    }

    // ─── Capital Management (AdminRegistry-whitelisted operator) ───────

    function deployCapital(address to, uint256 assets) external onlyOwner {
        _requireInitialized();
        require(to != address(0), "YieldVault: to=0");
        require(assets > 0, "YieldVault: zero deploy");
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        require(idle >= assets, "YieldVault: insufficient idle");

        deployedAssets += assets;
        require(IERC20(asset()).transfer(to, assets), "YieldVault: deploy failed");

        emit CapitalDeployed(to, assets, deployedAssets);
    }

    function returnCapital(address from, uint256 assets) external onlyOwner {
        _requireInitialized();
        require(from != address(0), "YieldVault: from=0");
        require(assets > 0, "YieldVault: zero return");
        require(assets <= deployedAssets, "YieldVault: exceeds deployed");

        deployedAssets -= assets;
        require(IERC20(asset()).transferFrom(from, address(this), assets), "YieldVault: return failed");

        emit CapitalReturned(from, assets, deployedAssets);
    }

    function reportStrategyGain(uint256 profit) external onlyOwner {
        _requireInitialized();
        require(profit > 0, "YieldVault: zero gain");

        deployedAssets += profit;

        emit StrategyGainReported(profit, totalAssets());
    }

    function reportStrategyLoss(uint256 loss) external onlyOwner {
        _requireInitialized();
        require(loss > 0, "YieldVault: zero loss");
        require(loss <= deployedAssets, "YieldVault: loss exceeds deployed");

        deployedAssets -= loss;

        emit StrategyLossReported(loss, totalAssets());
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

import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/extensions/IERC20Metadata.sol";
import "../../abstract/ERC20/utils/Pausable.sol";

/// @title SaveUSDSTVault
/// @notice A standalone USDST savings vault with ERC-4626-style accounting.
/// @dev The vault itself is the ERC-20 share token. Yield is added explicitly
///      through reward notifications rather than lending-pool utilization.
contract record SaveUSDSTVault is ERC20, Ownable, Pausable {
    address public assetToken;
    bool public vaultInitialized;
    uint8 private _underlyingDecimals;
    uint256 private _managedAssets;

    event VaultInitialized(address indexed assetToken, string name, string symbol);
    event RewardNotified(address indexed sender, uint256 amount);
    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    constructor(address initialOwner)
        Ownable(initialOwner)
        ERC20("", "")
    {}

    function initialize(address _assetToken, string name_, string symbol_) external onlyOwner {
        require(!vaultInitialized, "SaveUSDST: already initialized");
        require(_assetToken != address(0), "SaveUSDST: asset=0");
        require(_assetToken != address(this), "SaveUSDST: invalid asset");

        __ERC20_init(name_, symbol_);

        assetToken = _assetToken;
        _underlyingDecimals = _tryGetAssetDecimals(_assetToken);
        vaultInitialized = true;

        emit VaultInitialized(_assetToken, name_, symbol_);
    }

    function decimals() public view override returns (uint8) {
        if (!vaultInitialized) return 18;
        return _underlyingDecimals;
    }

    function asset() public view returns (address) {
        _requireInitialized();
        return assetToken;
    }

    function totalAssets() public view returns (uint256) {
        _requireInitialized();
        return _managedAssets;
    }

    function managedAssets() external view returns (uint256) {
        return totalAssets();
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, false);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, false);
    }

    function maxDeposit(address) public view returns (uint256) {
        if (!vaultInitialized || paused()) return 0;
        return 2 ** 256 - 1;
    }

    function maxMint(address) public view returns (uint256) {
        if (!vaultInitialized || paused()) return 0;
        return 2 ** 256 - 1;
    }

    function maxWithdraw(address ownerAddress) public view returns (uint256) {
        if (!vaultInitialized || paused()) return 0;
        uint256 assets = _convertToAssets(balanceOf(ownerAddress), false);
        uint256 available = _managedAssets;
        return assets < available ? assets : available;
    }

    function maxRedeem(address ownerAddress) public view returns (uint256) {
        if (!vaultInitialized || paused()) return 0;
        return balanceOf(ownerAddress);
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, false);
    }

    function previewMint(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, true);
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, true);
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, false);
    }

    function deposit(uint256 assets, address receiver) external whenNotPaused returns (uint256 shares) {
        _requireInitialized();
        require(receiver != address(0), "SaveUSDST: receiver=0");
        shares = previewDeposit(assets);
        _deposit(_msgSender(), receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver) external whenNotPaused returns (uint256 assets) {
        _requireInitialized();
        require(receiver != address(0), "SaveUSDST: receiver=0");
        assets = previewMint(shares);
        _deposit(_msgSender(), receiver, assets, shares);
    }

    function withdraw(uint256 assets, address receiver, address ownerAddress) external whenNotPaused returns (uint256 shares) {
        _requireInitialized();
        require(receiver != address(0), "SaveUSDST: receiver=0");
        require(assets <= maxWithdraw(ownerAddress), "SaveUSDST: withdraw exceeds max");

        shares = previewWithdraw(assets);
        _withdraw(_msgSender(), receiver, ownerAddress, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address ownerAddress) external whenNotPaused returns (uint256 assets) {
        _requireInitialized();
        require(receiver != address(0), "SaveUSDST: receiver=0");
        require(shares <= maxRedeem(ownerAddress), "SaveUSDST: redeem exceeds max");

        assets = previewRedeem(shares);
        _withdraw(_msgSender(), receiver, ownerAddress, assets, shares);
    }

    function exchangeRate() external view returns (uint256) {
        _requireInitialized();
        if (totalSupply() == 0) return 1e18;
        return (totalAssets() * 1e18) / totalSupply();
    }

    /// @notice Pull USDST from the owner and credit it as savings rewards.
    function notifyReward(uint256 amount) external onlyOwner {
        _requireInitialized();
        require(amount > 0, "SaveUSDST: zero reward");

        uint256 beforeBalance = IERC20(assetToken).balanceOf(address(this));
        require(IERC20(assetToken).transferFrom(_msgSender(), address(this), amount), "SaveUSDST: reward transfer failed");
        uint256 delta = IERC20(assetToken).balanceOf(address(this)) - beforeBalance;
        require(delta > 0, "SaveUSDST: no reward delta");

        _managedAssets += delta;
        emit RewardNotified(_msgSender(), delta);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function recoverStrayAssets(address to) external onlyOwner {
        _requireInitialized();
        require(to != address(0), "SaveUSDST: bad recipient");

        uint256 balance = IERC20(assetToken).balanceOf(address(this));
        require(balance >= _managedAssets, "SaveUSDST: balance underflow");
        uint256 stray = balance - _managedAssets;
        require(stray > 0, "SaveUSDST: no stray");

        require(IERC20(assetToken).transfer(to, stray), "SaveUSDST: stray transfer failed");
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(token != assetToken, "SaveUSDST: no asset rescue");
        require(to != address(0), "SaveUSDST: bad recipient");
        require(IERC20(token).transfer(to, amount), "SaveUSDST: rescue transfer failed");
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal {
        require(assets > 0, "SaveUSDST: zero assets");
        require(shares > 0, "SaveUSDST: zero shares");

        uint256 beforeBalance = IERC20(assetToken).balanceOf(address(this));
        require(IERC20(assetToken).transferFrom(caller, address(this), assets), "SaveUSDST: deposit transfer failed");
        uint256 delta = IERC20(assetToken).balanceOf(address(this)) - beforeBalance;
        require(delta > 0, "SaveUSDST: no deposit delta");

        if (totalSupply() == 0) {
            require(_managedAssets == 0, "SaveUSDST: bad init state");
        }

        // If the underlying ever becomes fee-on-transfer, mint against actual assets received.
        if (delta != assets) {
            shares = _convertToShares(delta, false);
            require(shares > 0, "SaveUSDST: fee-on-transfer dust");
        }

        _managedAssets += delta;
        _mint(receiver, shares);

        emit Deposit(caller, receiver, delta, shares);
    }

    function _withdraw(address caller, address receiver, address ownerAddress, uint256 assets, uint256 shares) internal {
        require(assets > 0, "SaveUSDST: zero assets");
        require(shares > 0, "SaveUSDST: zero shares");

        if (caller != ownerAddress) {
            _spendAllowance(ownerAddress, caller, shares);
        }

        _burn(ownerAddress, shares);

        uint256 beforeBalance = IERC20(assetToken).balanceOf(address(this));
        require(IERC20(assetToken).transfer(receiver, assets), "SaveUSDST: withdraw transfer failed");
        uint256 delta = beforeBalance - IERC20(assetToken).balanceOf(address(this));
        require(delta > 0, "SaveUSDST: no withdraw delta");

        require(delta <= _managedAssets, "SaveUSDST: managed underflow");
        _managedAssets -= delta;

        emit Withdraw(caller, receiver, ownerAddress, delta, shares);
    }

    function _convertToShares(uint256 assets, bool roundUp) internal view returns (uint256) {
        _requireInitialized();
        uint256 supply = totalSupply();
        if (assets == 0) return 0;
        if (supply == 0 || _managedAssets == 0) return assets;
        return _mulDiv(assets, supply, _managedAssets, roundUp);
    }

    function _convertToAssets(uint256 shares, bool roundUp) internal view returns (uint256) {
        _requireInitialized();
        uint256 supply = totalSupply();
        if (shares == 0) return 0;
        if (supply == 0 || _managedAssets == 0) return shares;
        return _mulDiv(shares, _managedAssets, supply, roundUp);
    }

    function _mulDiv(uint256 x, uint256 y, uint256 denominator, bool roundUp) internal pure returns (uint256) {
        require(denominator > 0, "SaveUSDST: div by zero");
        uint256 z = (x * y) / denominator;
        if (roundUp && ((x * y) % denominator) > 0) {
            z += 1;
        }
        return z;
    }

    function _requireInitialized() internal view {
        require(vaultInitialized, "SaveUSDST: not initialized");
    }

    function _tryGetAssetDecimals(address token) internal view returns (uint8) {
        try IERC20Metadata(token).decimals() returns (uint8 tokenDecimals) {
            return tokenDecimals;
        } catch {
            return 18;
        }
    }
}

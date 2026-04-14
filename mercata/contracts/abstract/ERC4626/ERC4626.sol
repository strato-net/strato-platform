// SPDX-License-Identifier: MIT
// SolidVM port of OpenZeppelin Contracts (v5.6.0) (token/ERC20/extensions/ERC4626.sol)
//
// MERCATA_COMPATIBILITY summary:
// - Removed LowLevelCall, Memory, Math imports (low-level EVM optimizations not available in SolidVM)
// - Removed SafeERC20 (SolidVM ERC20 reverts on failure; direct calls with require suffice)
// - Replaced Math.Rounding enum + Math.mulDiv with inline _mulDiv(x, y, d, bool roundUp)
// - Replaced immutable vars with regular state variables + initializer pattern
// - Replaced type(uint256).max with 2**256 - 1
// - Replaced _tryGetAssetDecimals low-level staticcall with try/catch pattern
// - Removed IERC4626 interface inheritance (interface not yet ported to SolidVM)

import "../ERC20/ERC20.sol";
import "../ERC20/IERC20.sol";
import "../ERC20/extensions/IERC20Metadata.sol";

/**
 * @dev Implementation of the ERC-4626 "Tokenized Vault Standard" as defined in
 * https://eips.ethereum.org/EIPS/eip-4626[ERC-4626].
 *
 * This extension allows the minting and burning of "shares" (represented using the ERC-20 inheritance) in exchange for
 * underlying "assets" through standardized {deposit}, {mint}, {redeem} and {burn} workflows. This contract extends
 * the ERC-20 standard. Any additional extensions included along it would affect the "shares" token represented by this
 * contract and not the "assets" token which is an independent contract.
 *
 * [CAUTION]
 * ====
 * In empty (or nearly empty) ERC-4626 vaults, deposits are at high risk of being stolen through frontrunning
 * with a "donation" to the vault that inflates the price of a share. This is variously known as a donation or inflation
 * attack and is essentially a problem of slippage. Vault deployers can protect against this attack by making an initial
 * deposit of a non-trivial amount of the asset, such that price manipulation becomes infeasible. Withdrawals may
 * similarly be affected by slippage. Users can protect against this attack as well as unexpected slippage in general by
 * verifying the amount received is as expected, using a wrapper that performs these checks such as
 * https://github.com/fei-protocol/ERC4626#erc4626router-and-base[ERC4626Router].
 *
 * Since v4.9, this implementation introduces configurable virtual assets and shares to help developers mitigate that risk.
 * The `_decimalsOffset()` corresponds to an offset in the decimal representation between the underlying asset's decimals
 * and the vault decimals. This offset also determines the rate of virtual shares to virtual assets in the vault, which
 * itself determines the initial exchange rate. While not fully preventing the attack, analysis shows that the default
 * offset (0) makes it non-profitable even if an attacker is able to capture value from multiple user deposits, as a result
 * of the value being captured by the virtual shares (out of the attacker's donation) matching the attacker's expected gains.
 * With a larger offset, the attack becomes orders of magnitude more expensive than it is profitable. More details about the
 * underlying math can be found xref:ROOT:erc4626.adoc#inflation-attack[here].
 * ====
 *
 * [NOTE]
 * ====
 * When overriding this contract, some elements must be considered:
 *
 * * When overriding the behavior of the deposit or withdraw mechanisms, it is recommended to override the internal
 * functions. Overriding {_deposit} automatically affects both {deposit} and {mint}. Similarly, overriding {_withdraw}
 * automatically affects both {withdraw} and {redeem}. Overall it is not recommended to override the public facing
 * functions since that could lead to inconsistent behaviors between the {deposit} and {mint} or between {withdraw} and
 * {redeem}, which is documented to have led to loss of funds.
 *
 * * Overrides to the deposit or withdraw mechanism must be reflected in the preview functions as well.
 *
 * * {maxWithdraw} depends on {maxRedeem}. Therefore, overriding {maxRedeem} only is enough. On the other hand,
 * overriding {maxWithdraw} only would have no effect on {maxRedeem}, and could create an inconsistency between the two
 * functions.
 *
 * * If {previewRedeem} is overridden to revert, {maxWithdraw} must be overridden as necessary to ensure it
 * always return successfully.
 * ====
 */
abstract contract ERC4626 is ERC20 {
    //MERCATA_COMPATIBILITY: Replaced IERC20 private immutable with address + initializer pattern
    address private _asset;
    uint8 private _underlyingDecimals;

    bool private _erc4626Initialized;

    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    error ERC4626ExceededMaxDeposit(address receiver, uint256 assets, uint256 max);
    error ERC4626ExceededMaxMint(address receiver, uint256 shares, uint256 max);
    error ERC4626ExceededMaxWithdraw(address owner, uint256 assets, uint256 max);
    error ERC4626ExceededMaxRedeem(address owner, uint256 shares, uint256 max);

    /**
     * @dev Set the underlying asset contract. This must be an ERC20-compatible contract.
     */
    constructor(address asset_) {
        _underlyingDecimals = _tryGetAssetDecimals(asset_);
        _asset = asset_;
    }

    /**
     * @dev Initializer for proxy/factory pattern (mirrors __ERC20_init).
     */
    function __ERC4626_init(address asset_) internal {
        require(!_erc4626Initialized, "ERC4626: already initialized");
        _underlyingDecimals = _tryGetAssetDecimals(asset_);
        _asset = asset_;
        _erc4626Initialized = true;
    }

    //MERCATA_COMPATIBILITY: Replaces low-level staticcall + Memory + LowLevelCall with try/catch
    function _tryGetAssetDecimals(address token) internal view returns (uint8) {
        if (token != address(0)) {
            try IERC20Metadata(token).decimals() returns (uint8 tokenDecimals) {
                return tokenDecimals;
            } catch {}
        }
        return 18;
    }

    /**
     * @dev Decimals are computed by adding the decimal offset on top of the underlying asset's decimals. This
     * "original" value is cached during construction of the vault contract. If this read operation fails (e.g., the
     * asset has not been created yet), a default of 18 is used to represent the underlying asset's decimals.
     *
     * See {IERC20Metadata-decimals}.
     */
    function decimals() public view virtual override returns (uint8) { //MERCATA_COMPATIBILITY: Simplified override (no IERC4626 interface)
        return _underlyingDecimals + _decimalsOffset();
    }

    /** @dev See {IERC4626-asset}. */
    function asset() public view virtual returns (address) {
        return _asset;
    }

    /** @dev See {IERC4626-totalAssets}. */
    function totalAssets() public view virtual returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /** @dev See {IERC4626-convertToShares}. */
    function convertToShares(uint256 assets) public view virtual returns (uint256) {
        return _convertToShares(assets, false);
    }

    /** @dev See {IERC4626-convertToAssets}. */
    function convertToAssets(uint256 shares) public view virtual returns (uint256) {
        return _convertToAssets(shares, false);
    }

    /** @dev See {IERC4626-maxDeposit}. */
    function maxDeposit(address) public view virtual returns (uint256) {
        return 2 ** 256 - 1; //MERCATA_COMPATIBILITY: Replaces type(uint256).max
    }

    /** @dev See {IERC4626-maxMint}. */
    function maxMint(address) public view virtual returns (uint256) {
        return 2 ** 256 - 1; //MERCATA_COMPATIBILITY: Replaces type(uint256).max
    }

    /** @dev See {IERC4626-maxWithdraw}. */
    function maxWithdraw(address owner) public view virtual returns (uint256) {
        return previewRedeem(maxRedeem(owner));
    }

    /** @dev See {IERC4626-maxRedeem}. */
    function maxRedeem(address owner) public view virtual returns (uint256) {
        return balanceOf(owner);
    }

    /** @dev See {IERC4626-previewDeposit}. */
    function previewDeposit(uint256 assets) public view virtual returns (uint256) {
        return _convertToShares(assets, false);
    }

    /** @dev See {IERC4626-previewMint}. */
    function previewMint(uint256 shares) public view virtual returns (uint256) {
        return _convertToAssets(shares, true);
    }

    /** @dev See {IERC4626-previewWithdraw}. */
    function previewWithdraw(uint256 assets) public view virtual returns (uint256) {
        return _convertToShares(assets, true);
    }

    /** @dev See {IERC4626-previewRedeem}. */
    function previewRedeem(uint256 shares) public view virtual returns (uint256) {
        return _convertToAssets(shares, false);
    }

    /** @dev See {IERC4626-deposit}. */
    function deposit(uint256 assets, address receiver) public virtual returns (uint256) {
        uint256 maxAssets = maxDeposit(receiver);
        if (assets > maxAssets) {
            revert ERC4626ExceededMaxDeposit(receiver, assets, maxAssets);
        }

        uint256 shares = previewDeposit(assets);
        _deposit(_msgSender(), receiver, assets, shares);

        return shares;
    }

    /** @dev See {IERC4626-mint}. */
    function mint(uint256 shares, address receiver) public virtual returns (uint256) {
        uint256 maxShares = maxMint(receiver);
        if (shares > maxShares) {
            revert ERC4626ExceededMaxMint(receiver, shares, maxShares);
        }

        uint256 assets = previewMint(shares);
        _deposit(_msgSender(), receiver, assets, shares);

        return assets;
    }

    /** @dev See {IERC4626-withdraw}. */
    function withdraw(uint256 assets, address receiver, address owner) public virtual returns (uint256) {
        uint256 maxAssets = maxWithdraw(owner);
        if (assets > maxAssets) {
            revert ERC4626ExceededMaxWithdraw(owner, assets, maxAssets);
        }

        uint256 shares = previewWithdraw(assets);
        _withdraw(_msgSender(), receiver, owner, assets, shares);

        return shares;
    }

    /** @dev See {IERC4626-redeem}. */
    function redeem(uint256 shares, address receiver, address owner) public virtual returns (uint256) {
        uint256 maxShares = maxRedeem(owner);
        if (shares > maxShares) {
            revert ERC4626ExceededMaxRedeem(owner, shares, maxShares);
        }

        uint256 assets = previewRedeem(shares);
        _withdraw(_msgSender(), receiver, owner, assets, shares);

        return assets;
    }

    /**
     * @dev Internal conversion function (from assets to shares) with support for rounding direction.
     * Includes virtual shares/assets (10 ** _decimalsOffset() and +1) for inflation attack mitigation.
     */
    function _convertToShares(uint256 assets, bool roundUp) internal view virtual returns (uint256) {
        return _mulDiv(assets, totalSupply() + 10 ** _decimalsOffset(), totalAssets() + 1, roundUp);
    }

    /**
     * @dev Internal conversion function (from shares to assets) with support for rounding direction.
     */
    function _convertToAssets(uint256 shares, bool roundUp) internal view virtual returns (uint256) {
        return _mulDiv(shares, totalAssets() + 1, totalSupply() + 10 ** _decimalsOffset(), roundUp);
    }

    /**
     * @dev Deposit/mint common workflow.
     */
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal virtual {
        // Transfer before mint so that any reentrancy would happen before the
        // assets are transferred and before the shares are minted, which is a valid state.
        _transferIn(caller, assets);
        _mint(receiver, shares);

        emit Deposit(caller, receiver, assets, shares);
    }

    /**
     * @dev Withdraw/redeem common workflow.
     */
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        // Burn before transfer so that any reentrancy would happen after the
        // shares are burned and after the assets are transferred, which is a valid state.
        _burn(owner, shares);
        _transferOut(receiver, assets);

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    //MERCATA_COMPATIBILITY: Direct IERC20 calls replace SafeERC20 (SolidVM ERC20 reverts on failure)
    function _transferIn(address from, uint256 assets) internal virtual {
        require(IERC20(asset()).transferFrom(from, address(this), assets), "ERC4626: transferIn failed");
    }

    //MERCATA_COMPATIBILITY: Direct IERC20 calls replace SafeERC20 (SolidVM ERC20 reverts on failure)
    function _transferOut(address to, uint256 assets) internal virtual {
        require(IERC20(asset()).transfer(to, assets), "ERC4626: transferOut failed");
    }

    function _decimalsOffset() internal view virtual returns (uint8) {
        return 0;
    }

    //MERCATA_COMPATIBILITY: Replaces OpenZeppelin Math.mulDiv (assembly-optimized) with pure Solidity
    function _mulDiv(uint256 x, uint256 y, uint256 denominator, bool roundUp) internal pure returns (uint256) {
        require(denominator > 0, "ERC4626: div by zero");
        uint256 z = (x * y) / denominator;
        if (roundUp && ((x * y) % denominator) > 0) {
            z += 1;
        }
        return z;
    }
}

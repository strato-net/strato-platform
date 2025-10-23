pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract DepositRouter is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Custom Errors ============
    error UseDepositETH();
    error BelowMinimum();
    error ZeroAmount();
    error PermitExpired();
    error InvalidAddress();
    error ETHTransferFailed();
    error ArrayLengthMismatch();
    error SameAddressProposed();
    error SweepEthFailed();
    error NotPermitted();
    error InvalidPermissions();

    // ============ State Variables ============
    //Notice that in most chains, PERMIT2 is deployed at 0x000000000022D473030F116dDEE9F6B43aC78BA3
    // https://etherscan.io/address/0x000000000022d473030f116ddee9f6b43ac78ba3
    IPermit2 public immutable PERMIT2;

    address public gnosisSafe;
    uint96 public depositId;
    // address(0) represents ETH configuration for depositETH()
    mapping(address => TokenConfig) public tokenConfig;

    // ============ Structs ============
    struct TokenConfig {
        uint96 min;
    }

    // ============ Events ============
    event DepositRouted(
        address indexed token,
        uint256 amount,
        address indexed sender,
        address indexed stratoAddress,
        uint96 depositId
    );
    event TokenConfigUpdated(address indexed token, uint256 minAmount);
    event GnosisSafeUpdated(address indexed oldSafe, address indexed newSafe);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address permit2_) {
        if (permit2_ == address(0)) revert InvalidAddress();
        PERMIT2 = IPermit2(permit2_);
        _disableInitializers();
    }

    function initialize(
        address gnosisSafe_,
        address owner_
    ) public initializer {
        if (owner_ == address(0) || gnosisSafe_ == address(0))
            revert InvalidAddress();
        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        gnosisSafe = gnosisSafe_;
        emit GnosisSafeUpdated(address(0), gnosisSafe_);
    }

    function deposit(
        address token,
        uint256 amount,
        address stratoAddress,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (token == address(0)) revert UseDepositETH();
        if (stratoAddress == address(0)) revert InvalidAddress();
        if (deadline < block.timestamp) revert PermitExpired();

        TokenConfig storage c = tokenConfig[token];
        if (amount < c.min) revert BelowMinimum();

        address safe = gnosisSafe;
        unchecked {
            ++depositId;
        }

        uint256 balanceBefore = IERC20(token).balanceOf(safe);

        IPermit2.PermitTransferFrom memory permit = IPermit2
            .PermitTransferFrom({
                permitted: IPermit2.TokenPermissions({
                    token: token,
                    amount: amount
                }),
                nonce: nonce,
                deadline: deadline
            });
        IPermit2.SignatureTransferDetails memory transferDetails = IPermit2
            .SignatureTransferDetails({to: safe, requestedAmount: amount});
        PERMIT2.permitTransferFrom(
            permit,
            transferDetails,
            msg.sender,
            signature
        );

        uint256 depositedAmount = IERC20(token).balanceOf(safe) - balanceBefore;

        emit DepositRouted(
            token,
            depositedAmount,
            msg.sender,
            stratoAddress,
            depositId
        );
    }

    // using address(0) for ETH
    function depositETH(
        address stratoAddress
    ) external payable whenNotPaused nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        if (stratoAddress == address(0)) revert InvalidAddress();

        TokenConfig storage c = tokenConfig[address(0)];
        if (msg.value < c.min) revert BelowMinimum();

        address safe = gnosisSafe;
        unchecked {
            ++depositId;
        }

        (bool success, ) = safe.call{value: msg.value}("");
        if (!success) revert ETHTransferFailed();

        emit DepositRouted(
            address(0),
            msg.value,
            msg.sender,
            stratoAddress,
            depositId
        );
    }

    function setMinDepositAmount(
        address token,
        uint96 minAmount
    ) external onlyOwner {
        TokenConfig storage c = tokenConfig[token];
        if (c.min == minAmount) return;
        c.min = minAmount;
        emit TokenConfigUpdated(token, minAmount);
    }

    function batchUpdateTokens(
        address[] calldata tokens,
        uint96[] calldata minAmounts
    ) external onlyOwner {
        uint256 len = tokens.length;
        if (len != minAmounts.length) revert ArrayLengthMismatch();

        for (uint256 i; i < len; ) {
            address t = tokens[i];
            uint96 m = minAmounts[i];
            TokenConfig storage c = tokenConfig[t];
            c.min = m;
            emit TokenConfigUpdated(t, m);
            unchecked {
                ++i;
            }
        }
    }

    function setGnosisSafe(address newSafe) external onlyOwner {
        if (newSafe == address(0)) revert InvalidAddress();
        address old = gnosisSafe;
        if (newSafe == old) revert SameAddressProposed();
        gnosisSafe = newSafe;
        emit GnosisSafeUpdated(old, newSafe);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function canDeposit(
        address token,
        uint256 amount
    ) external view returns (bool) {
        if (amount == 0 || paused()) return false;

        TokenConfig storage c = tokenConfig[token];
        if (amount < c.min) return false;
        return true;
    }

    function version() external pure virtual returns (string memory) {
        return "1.0.0";
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    receive() external payable {
        revert UseDepositETH();
    }
    fallback() external payable {
        revert UseDepositETH();
    }

    function sweepETH(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        (bool ok, ) = to.call{value: address(this).balance}("");
        if (!ok) revert SweepEthFailed();
    }

    function sweepERC20(
        address token,
        address to
    ) external onlyOwner nonReentrant {
        if (to == address(0) || token == address(0)) revert InvalidAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal != 0) IERC20(token).safeTransfer(to, bal);
    }
}

// see https://github.com/dragonfly-xyz/useful-solidity-patterns/blob/main/patterns/permit2/Permit2Vault.sol
interface IPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function permitTransferFrom(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}

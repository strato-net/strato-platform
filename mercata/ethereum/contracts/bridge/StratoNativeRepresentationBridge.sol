// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./StratoNativeRepresentationToken.sol";

/// @title StratoNativeRepresentationBridge
/// @notice Controls minting of external representation tokens and user-initiated redemption requests.
/// @notice Redemption is safe because the bridge first receives representation tokens from the user,
///         then burns only the tokens held by this contract, and finally emits a canonical event for relayers.
contract StratoNativeRepresentationBridge is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant BRIDGE_OPERATOR_ROLE = keccak256("BRIDGE_OPERATOR");

    mapping(address => address) public stratoToRepresentation;
    mapping(address => address) public representationToStrato;

    uint96 public redemptionId;

    event RepresentationMinted(
        address indexed stratoToken,
        address indexed representationToken,
        address indexed recipient,
        uint256 amount
    );
    event RedemptionRequested(
        address indexed representationToken,
        uint256 amount,
        address indexed sender,
        address indexed stratoRecipient,
        uint96 redemptionId
    );
    event TokenMappingUpdated(address indexed stratoToken, address indexed representationToken);

    error InvalidAddress();
    error ZeroAmount();
    error TokenNotMapped();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        if (admin == address(0)) revert InvalidAddress();

        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function mintRepresentation(
        address stratoToken,
        address recipient,
        uint256 amount
    ) external onlyRole(BRIDGE_OPERATOR_ROLE) whenNotPaused {
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();

        address representationToken = stratoToRepresentation[stratoToken];
        if (representationToken == address(0)) revert TokenNotMapped();

        StratoNativeRepresentationToken(representationToken).mint(recipient, amount);

        emit RepresentationMinted(stratoToken, representationToken, recipient, amount);
    }

    function requestRedemption(
        address representationToken,
        uint256 amount,
        address stratoRecipient
    ) external whenNotPaused nonReentrant {
        if (representationToken == address(0)) revert InvalidAddress();
        if (stratoRecipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();
        if (representationToStrato[representationToken] == address(0)) revert TokenNotMapped();

        IERC20(representationToken).safeTransferFrom(msg.sender, address(this), amount);
        StratoNativeRepresentationToken(representationToken).burn(amount);

        unchecked {
            ++redemptionId;
        }

        emit RedemptionRequested(
            representationToken,
            amount,
            msg.sender,
            stratoRecipient,
            redemptionId
        );
    }

    function setTokenMapping(
        address stratoToken,
        address representationToken
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (stratoToken == address(0) || representationToken == address(0)) revert InvalidAddress();

        stratoToRepresentation[stratoToken] = representationToken;
        representationToStrato[representationToken] = stratoToken;

        emit TokenMappingUpdated(stratoToken, representationToken);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

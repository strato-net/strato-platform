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
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant MAPPING_ADMIN_ROLE = keccak256("MAPPING_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");

    mapping(address => address) public stratoToRepresentation;
    mapping(address => address) public representationToStrato;
    mapping(address => bool) public routeActive;
    mapping(address => bool) public routeFrozen;
    mapping(bytes32 => bool) public processedMints;

    uint96 public redemptionId;
    bool public mintsPaused;
    bool public redemptionsPaused;

    event RepresentationMinted(
        uint256 sourceChainId,
        address indexed sourceBridge,
        uint256 indexed sourceWithdrawalId,
        address indexed stratoToken,
        address representationToken,
        address recipient,
        uint256 amount,
        bytes32 mintId
    );
    event RedemptionRequested(
        address indexed representationToken,
        uint256 amount,
        address indexed sender,
        address indexed stratoRecipient,
        uint96 redemptionId
    );
    event TokenMappingRegistered(
        address indexed stratoToken,
        address indexed representationToken,
        bool frozen
    );
    event TokenMappingDisabled(
        address indexed stratoToken,
        address indexed representationToken
    );
    event TokenMappingFrozen(
        address indexed stratoToken,
        address indexed representationToken
    );
    event TokenMappingMigrated(
        address indexed stratoToken,
        address indexed previousRepresentationToken,
        address indexed newRepresentationToken,
        bool frozen
    );
    event MintPauseUpdated(bool paused);
    event RedemptionPauseUpdated(bool paused);

    error InvalidAddress();
    error ZeroAmount();
    error TokenNotMapped();
    error RouteDisabled();
    error RouteFrozen();
    error ExistingTokenMapping();
    error RepresentationAlreadyMapped();
    error DuplicateMint();
    error MintsPaused();
    error RedemptionsPaused();
    error RouteHasSupply();

    modifier whenMintsNotPaused() {
        if (mintsPaused) revert MintsPaused();
        _;
    }

    modifier whenRedemptionsNotPaused() {
        if (redemptionsPaused) revert RedemptionsPaused();
        _;
    }

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
        _grantRole(UPGRADER_ROLE, admin);
        _grantRole(MAPPING_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(UNPAUSER_ROLE, admin);
    }

    function mintRepresentation(
        uint256 sourceChainId,
        address sourceBridge,
        uint256 sourceWithdrawalId,
        address stratoToken,
        address recipient,
        uint256 amount
    ) external onlyRole(BRIDGE_OPERATOR_ROLE) whenNotPaused whenMintsNotPaused {
        if (sourceChainId == 0) revert InvalidAddress();
        if (sourceBridge == address(0)) revert InvalidAddress();
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();

        address representationToken = stratoToRepresentation[stratoToken];
        if (representationToken == address(0)) revert TokenNotMapped();
        if (!routeActive[stratoToken]) revert RouteDisabled();

        bytes32 mintId = keccak256(
            abi.encode(sourceChainId, sourceBridge, sourceWithdrawalId)
        );
        if (processedMints[mintId]) revert DuplicateMint();
        processedMints[mintId] = true;

        StratoNativeRepresentationToken(representationToken).mint(recipient, amount);

        emit RepresentationMinted(
            sourceChainId,
            sourceBridge,
            sourceWithdrawalId,
            stratoToken,
            representationToken,
            recipient,
            amount,
            mintId
        );
    }

    function requestRedemption(
        address representationToken,
        uint256 amount,
        address stratoRecipient
    ) external whenNotPaused whenRedemptionsNotPaused nonReentrant {
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

    function registerTokenMapping(
        address stratoToken,
        address representationToken,
        bool freezeRoute
    ) public onlyRole(MAPPING_ADMIN_ROLE) {
        if (stratoToken == address(0) || representationToken == address(0)) revert InvalidAddress();
        if (stratoToRepresentation[stratoToken] != address(0)) revert ExistingTokenMapping();
        if (representationToStrato[representationToken] != address(0)) revert RepresentationAlreadyMapped();

        stratoToRepresentation[stratoToken] = representationToken;
        representationToStrato[representationToken] = stratoToken;
        routeActive[stratoToken] = true;
        routeFrozen[stratoToken] = freezeRoute;

        emit TokenMappingRegistered(stratoToken, representationToken, freezeRoute);
    }

    function setTokenMapping(
        address stratoToken,
        address representationToken
    ) external onlyRole(MAPPING_ADMIN_ROLE) {
        registerTokenMapping(stratoToken, representationToken, false);
    }

    function disableTokenMapping(address stratoToken) external onlyRole(MAPPING_ADMIN_ROLE) {
        address representationToken = stratoToRepresentation[stratoToken];
        if (representationToken == address(0)) revert TokenNotMapped();
        routeActive[stratoToken] = false;
        emit TokenMappingDisabled(stratoToken, representationToken);
    }

    function freezeTokenMapping(address stratoToken) external onlyRole(MAPPING_ADMIN_ROLE) {
        address representationToken = stratoToRepresentation[stratoToken];
        if (representationToken == address(0)) revert TokenNotMapped();
        routeFrozen[stratoToken] = true;
        emit TokenMappingFrozen(stratoToken, representationToken);
    }

    function migrateTokenMapping(
        address stratoToken,
        address newRepresentationToken,
        bool freezeRoute
    ) external onlyRole(MAPPING_ADMIN_ROLE) whenPaused {
        address currentRepresentationToken = stratoToRepresentation[stratoToken];
        if (currentRepresentationToken == address(0)) revert TokenNotMapped();
        if (newRepresentationToken == address(0)) revert InvalidAddress();
        if (routeFrozen[stratoToken]) revert RouteFrozen();
        if (representationToStrato[newRepresentationToken] != address(0)) {
            revert RepresentationAlreadyMapped();
        }
        if (IERC20(currentRepresentationToken).totalSupply() != 0) revert RouteHasSupply();

        representationToStrato[currentRepresentationToken] = address(0);
        stratoToRepresentation[stratoToken] = newRepresentationToken;
        representationToStrato[newRepresentationToken] = stratoToken;
        routeActive[stratoToken] = true;
        routeFrozen[stratoToken] = freezeRoute;

        emit TokenMappingMigrated(
            stratoToken,
            currentRepresentationToken,
            newRepresentationToken,
            freezeRoute
        );
    }

    function setMintPaused(bool paused_) external {
        if (paused_) {
            _checkRole(PAUSER_ROLE);
        } else {
            _checkRole(UNPAUSER_ROLE);
        }
        mintsPaused = paused_;
        emit MintPauseUpdated(paused_);
    }

    function setRedemptionsPaused(bool paused_) external {
        if (paused_) {
            _checkRole(PAUSER_ROLE);
        } else {
            _checkRole(UNPAUSER_ROLE);
        }
        redemptionsPaused = paused_;
        emit RedemptionPauseUpdated(paused_);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(UNPAUSER_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

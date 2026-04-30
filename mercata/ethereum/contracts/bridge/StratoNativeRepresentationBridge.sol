// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

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
    EIP712Upgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant MAPPING_ADMIN_ROLE = keccak256("MAPPING_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");
    bytes32 public constant ATTESTATION_ADMIN_ROLE = keccak256("ATTESTATION_ADMIN_ROLE");
    bytes32 private constant NATIVE_MINT_ATTESTATION_TYPEHASH = keccak256(
        "NativeMintAttestation(uint256 sourceChainId,address sourceBridge,uint256 destinationChainId,address destinationBridge,uint256 sourceWithdrawalId,address stratoToken,address representationToken,address recipient,uint256 amount,uint256 deadline)"
    );

    struct NativeMintAttestation {
        uint256 sourceChainId;
        address sourceBridge;
        uint256 destinationChainId;
        address destinationBridge;
        uint256 sourceWithdrawalId;
        address stratoToken;
        address representationToken;
        address recipient;
        uint256 amount;
        uint256 deadline;
    }

    mapping(address => address) public stratoToRepresentation;
    mapping(address => address) public representationToStrato;
    mapping(address => bool) public routeActive;
    mapping(address => bool) public routeFrozen;
    mapping(bytes32 => bool) public processedMints;
    mapping(address => bool) public attestationSigners;

    uint96 public redemptionId;
    uint8 public attestationThreshold;
    uint8 public attestationSignerCount;
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
    event AttestationSignerUpdated(address indexed signer, bool enabled);
    event AttestationThresholdUpdated(uint8 threshold);

    error InvalidAddress();
    error ZeroAmount();
    error InvalidAttestation();
    error InvalidAttestationThreshold();
    error AttestationExpired();
    error BadAttestationSignatures();
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
        __EIP712_init("StratoNativeRepresentationBridge", "1");
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        _grantRole(MAPPING_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(UNPAUSER_ROLE, admin);
        _grantRole(ATTESTATION_ADMIN_ROLE, admin);
    }

    function mintRepresentationWithAttestation(
        NativeMintAttestation calldata attestation,
        bytes[] calldata signatures
    ) external whenNotPaused whenMintsNotPaused {
        bytes32 mintId = _validateMintAttestation(attestation);
        _verifyAttestationSignatures(attestationDigest(attestation), signatures);

        if (processedMints[mintId]) revert DuplicateMint();
        processedMints[mintId] = true;

        StratoNativeRepresentationToken(attestation.representationToken).mint(
            attestation.recipient,
            attestation.amount
        );

        emit RepresentationMinted(
            attestation.sourceChainId,
            attestation.sourceBridge,
            attestation.sourceWithdrawalId,
            attestation.stratoToken,
            attestation.representationToken,
            attestation.recipient,
            attestation.amount,
            mintId
        );
    }

    function attestationDigest(
        NativeMintAttestation calldata attestation
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    NATIVE_MINT_ATTESTATION_TYPEHASH,
                    attestation.sourceChainId,
                    attestation.sourceBridge,
                    attestation.destinationChainId,
                    attestation.destinationBridge,
                    attestation.sourceWithdrawalId,
                    attestation.stratoToken,
                    attestation.representationToken,
                    attestation.recipient,
                    attestation.amount,
                    attestation.deadline
                )
            )
        );
    }

    function _validateMintAttestation(
        NativeMintAttestation calldata attestation
    ) internal view returns (bytes32 mintId) {
        if (attestation.sourceChainId == 0) revert InvalidAttestation();
        if (attestation.sourceBridge == address(0)) revert InvalidAttestation();
        if (attestation.sourceWithdrawalId == 0) revert InvalidAttestation();
        if (attestation.destinationChainId != block.chainid) revert InvalidAttestation();
        if (attestation.destinationBridge != address(this)) revert InvalidAttestation();
        if (attestation.recipient == address(0)) revert InvalidAddress();
        if (attestation.amount == 0) revert ZeroAmount();
        if (attestation.deadline < block.timestamp) revert AttestationExpired();

        address representationToken = stratoToRepresentation[attestation.stratoToken];
        if (representationToken == address(0)) revert TokenNotMapped();
        if (representationToken != attestation.representationToken) revert InvalidAttestation();
        if (!routeActive[attestation.stratoToken]) revert RouteDisabled();

        mintId = keccak256(
            abi.encode(
                attestation.sourceChainId,
                attestation.sourceBridge,
                attestation.sourceWithdrawalId
            )
        );
    }

    function _verifyAttestationSignatures(
        bytes32 digest,
        bytes[] calldata signatures
    ) internal view {
        uint8 threshold = attestationThreshold;
        if (threshold == 0 || signatures.length < threshold) {
            revert InvalidAttestationThreshold();
        }

        address previousSigner = address(0);
        uint8 validSignatures = 0;
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = digest.recover(signatures[i]);
            if (!attestationSigners[signer] || signer <= previousSigner) {
                revert BadAttestationSignatures();
            }
            previousSigner = signer;
            unchecked {
                ++validSignatures;
            }
        }

        if (validSignatures < threshold) revert BadAttestationSignatures();
    }

    function requestRedemption(
        address representationToken,
        uint256 amount,
        address stratoRecipient
    ) external whenNotPaused whenRedemptionsNotPaused nonReentrant {
        if (representationToken == address(0)) revert InvalidAddress();
        if (stratoRecipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert ZeroAmount();
        address stratoToken = representationToStrato[representationToken];
        if (stratoToken == address(0)) revert TokenNotMapped();
        if (!routeActive[stratoToken]) revert RouteDisabled();

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

    function setAttestationSigner(
        address signer,
        bool enabled
    ) external onlyRole(ATTESTATION_ADMIN_ROLE) {
        if (signer == address(0)) revert InvalidAddress();
        bool currentlyEnabled = attestationSigners[signer];
        if (currentlyEnabled == enabled) {
            return;
        }

        if (enabled) {
            unchecked {
                ++attestationSignerCount;
            }
        } else {
            uint8 newSignerCount = attestationSignerCount - 1;
            if (attestationThreshold > newSignerCount) revert InvalidAttestationThreshold();
            attestationSignerCount = newSignerCount;
        }

        attestationSigners[signer] = enabled;
        emit AttestationSignerUpdated(signer, enabled);
    }

    function setAttestationThreshold(
        uint8 threshold
    ) external onlyRole(ATTESTATION_ADMIN_ROLE) {
        if (threshold == 0 || threshold > attestationSignerCount) {
            revert InvalidAttestationThreshold();
        }

        attestationThreshold = threshold;
        emit AttestationThresholdUpdated(threshold);
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

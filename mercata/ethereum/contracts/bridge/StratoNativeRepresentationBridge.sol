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
import "./STRATOLightClient.sol";
import {MerklePatricia} from "./lib/MerklePatricia.sol";
import {STRATOEventDecoder} from "./lib/STRATOEventDecoder.sol";

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
        "NativeMintAttestation(uint256 sourceChainId,address sourceBridge,uint256 destinationChainId,address destinationBridge,uint256 sourceWithdrawalId,address stratoToken,address representationToken,address recipient,uint256 amount,uint256 notBefore,uint256 deadline)"
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
        uint256 notBefore;
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
    uint256 public maxAttestationValiditySeconds;
    bool public mintsPaused;
    bool public redemptionsPaused;

    // ─────────────────────────────────────────────────────────────
    // Trustless mint path (v2). State appended at the end so existing
    // proxy storage slots stay stable on upgrade.
    // ─────────────────────────────────────────────────────────────

    /// @notice STRATOLightClient deployment on this chain that anchors
    ///         STRATO receipts roots. The trustless mint path looks
    ///         this up via `getReceiptsRoot(blockNumber)` and refuses
    ///         to mint until a STRATO block is anchored.
    /// @dev    Zero address ⇒ trustless mint is disabled (only the
    ///         existing attestation path works).
    STRATOLightClient public stratoLightClient;

    /// @notice The StratoNativeBridge address on STRATO. The decoder's
    ///         `contractAddress` must equal this — any other emitter
    ///         is rejected even if it produced a perfectly-shaped log.
    address public stratoNativeBridge;

    /// @notice STRATO's chain id, used as the `sourceChainId` component
    ///         of the dedup key (`mintId`) so the trustless and
    ///         attestation paths share replay protection.
    uint256 public stratoSourceChainId;

    /// @notice keccak256("NativeWithdrawalRequested"). Held in storage
    ///         (vs constant) so a future event-name revision doesn't
    ///         force a contract redeploy — admins can rotate via
    ///         {setNativeWithdrawalEventName}.
    bytes32 public nativeWithdrawalEventNameHash;

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
    event TokenMappingEnabled(
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
    event MaxAttestationValidityUpdated(uint256 previousValiditySeconds, uint256 newValiditySeconds);

    /// @notice Emitted when a representation is minted via the trustless
    ///         proof path (vs the attestation path). Indexers can split
    ///         metrics by mint origin.
    event RepresentationMintedTrustlessly(
        uint256 stratoBlockNumber,
        uint256 stratoTxIndex,
        uint256 stratoLogIndex,
        address indexed stratoToken,
        address representationToken,
        address recipient,
        uint256 amount,
        bytes32 mintId
    );
    event StratoLightClientUpdated(address indexed previousLightClient, address indexed newLightClient);
    event StratoNativeBridgeUpdated(address indexed previousBridge, address indexed newBridge);
    event StratoSourceChainIdUpdated(uint256 previousChainId, uint256 newChainId);
    event NativeWithdrawalEventNameHashUpdated(bytes32 previousHash, bytes32 newHash);

    error InvalidAddress();
    error ZeroAmount();
    error InvalidAttestation();
    error InvalidAttestationThreshold();
    error AttestationNotReady();
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

    // Trustless mint-path errors:
    error TrustlessMintDisabled();        // stratoLightClient unset
    error StratoBlockNotAnchored();       // LC.getReceiptsRoot returned bytes32(0)
    error ProofVerificationFailed();      // MPT inclusion failed
    error WrongSourceBridge();             // log emitter != configured stratoNativeBridge
    error WrongDestinationChain();         // decoded externalChainId != block.chainid
    error WrongDestinationBridge();        // decoded externalBridge != address(this)
    error UnexpectedEventName();            // log eventName != configured nativeWithdrawalEventNameHash
    error RepresentationMismatch();         // decoded representationToken != stratoToRepresentation[stratoToken]

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
        maxAttestationValiditySeconds = 7 days;
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
                    attestation.notBefore,
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
        if (attestation.notBefore > block.timestamp) revert AttestationNotReady();
        if (attestation.deadline < block.timestamp) revert AttestationExpired();
        if (attestation.deadline < attestation.notBefore) revert InvalidAttestation();
        if (attestation.deadline > attestation.notBefore + maxAttestationValiditySeconds) {
            revert InvalidAttestation();
        }

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

    function enableTokenMapping(address stratoToken) external onlyRole(MAPPING_ADMIN_ROLE) {
        address representationToken = stratoToRepresentation[stratoToken];
        if (representationToken == address(0)) revert TokenNotMapped();
        routeActive[stratoToken] = true;
        emit TokenMappingEnabled(stratoToken, representationToken);
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

    function setMaxAttestationValiditySeconds(
        uint256 validitySeconds
    ) external onlyRole(ATTESTATION_ADMIN_ROLE) {
        if (validitySeconds == 0) revert InvalidAttestation();
        uint256 previousValiditySeconds = maxAttestationValiditySeconds;
        maxAttestationValiditySeconds = validitySeconds;
        emit MaxAttestationValidityUpdated(previousValiditySeconds, validitySeconds);
    }

    // ─────────────────────────────────────────────────────────────
    // Trustless mint path (v2)
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Convenience initializer that sets all four trustless-
     *         mint config fields atomically. Equivalent to calling the
     *         four per-field setters in sequence, but bundled so a
     *         post-upgrade hook can wire the proxy in one tx without a
     *         half-configured window.
     *
     *         Subsequent reconfiguration uses the per-field setters
     *         (each guarded by MAPPING_ADMIN_ROLE) — this initializer
     *         can be re-called by DEFAULT_ADMIN_ROLE if the admin wants
     *         to swap multiple fields together; it's not single-shot.
     */
    function initializeTrustlessMint(
        address lightClient_,
        address stratoNativeBridge_,
        uint256 stratoSourceChainId_,
        bytes32 nativeWithdrawalEventNameHash_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (lightClient_ == address(0)) revert InvalidAddress();
        if (stratoNativeBridge_ == address(0)) revert InvalidAddress();
        if (stratoSourceChainId_ == 0) revert WrongDestinationChain();
        if (nativeWithdrawalEventNameHash_ == bytes32(0)) revert UnexpectedEventName();

        address previousLC = address(stratoLightClient);
        address previousBridge = stratoNativeBridge;
        uint256 previousChainId = stratoSourceChainId;
        bytes32 previousHash = nativeWithdrawalEventNameHash;

        stratoLightClient = STRATOLightClient(lightClient_);
        stratoNativeBridge = stratoNativeBridge_;
        stratoSourceChainId = stratoSourceChainId_;
        nativeWithdrawalEventNameHash = nativeWithdrawalEventNameHash_;

        emit StratoLightClientUpdated(previousLC, lightClient_);
        emit StratoNativeBridgeUpdated(previousBridge, stratoNativeBridge_);
        emit StratoSourceChainIdUpdated(previousChainId, stratoSourceChainId_);
        emit NativeWithdrawalEventNameHashUpdated(previousHash, nativeWithdrawalEventNameHash_);
    }

    function setStratoLightClient(address newLightClient) external onlyRole(MAPPING_ADMIN_ROLE) {
        if (newLightClient == address(0)) revert InvalidAddress();
        address previous = address(stratoLightClient);
        stratoLightClient = STRATOLightClient(newLightClient);
        emit StratoLightClientUpdated(previous, newLightClient);
    }

    function setStratoNativeBridge(address newBridge) external onlyRole(MAPPING_ADMIN_ROLE) {
        if (newBridge == address(0)) revert InvalidAddress();
        address previous = stratoNativeBridge;
        stratoNativeBridge = newBridge;
        emit StratoNativeBridgeUpdated(previous, newBridge);
    }

    function setStratoSourceChainId(uint256 newChainId) external onlyRole(MAPPING_ADMIN_ROLE) {
        if (newChainId == 0) revert WrongDestinationChain();
        uint256 previous = stratoSourceChainId;
        stratoSourceChainId = newChainId;
        emit StratoSourceChainIdUpdated(previous, newChainId);
    }

    function setNativeWithdrawalEventName(bytes32 newHash) external onlyRole(MAPPING_ADMIN_ROLE) {
        if (newHash == bytes32(0)) revert UnexpectedEventName();
        bytes32 previous = nativeWithdrawalEventNameHash;
        nativeWithdrawalEventNameHash = newHash;
        emit NativeWithdrawalEventNameHashUpdated(previous, newHash);
    }

    /**
     * @notice Trustless mint: prove a `NativeWithdrawalRequested` log
     *         was emitted by the configured {stratoNativeBridge} on a
     *         STRATO block whose receipts root has been anchored by
     *         {stratoLightClient}. On success the corresponding
     *         representation tokens are minted to the recipient encoded
     *         in the event.
     *
     *         This is the trust-minimized analog of
     *         {mintRepresentationWithAttestation}. Both paths share the
     *         {processedMints} dedup so a withdrawal can't be minted
     *         twice via different paths.
     *
     *         The caller need not be the recipient. The proof itself
     *         determines the recipient — anyone willing to spend the
     *         gas can complete a stuck mint.
     *
     * @param  stratoBlockNumber STRATO block in which the event lives.
     *                           Must already be anchored on {stratoLightClient}.
     * @param  txIndex           Position of the originating tx within the STRATO block.
     * @param  logIndex          Position of the NativeWithdrawalRequested log
     *                           within that tx's receipt's logs[].
     * @param  mptProof          Receipts-trie inclusion proof root → leaf.
     * @param  receiptRLP        The trie leaf — RLP-encoded receipt at txIndex.
     */
    function mintRepresentationWithProof(
        uint256 stratoBlockNumber,
        uint256 txIndex,
        uint256 logIndex,
        bytes[] calldata mptProof,
        bytes calldata receiptRLP
    ) external whenNotPaused whenMintsNotPaused nonReentrant {
        if (address(stratoLightClient) == address(0)) revert TrustlessMintDisabled();

        // 1. STRATO block must be anchored on the light client.
        bytes32 receiptsRoot = stratoLightClient.getReceiptsRoot(stratoBlockNumber);
        if (receiptsRoot == bytes32(0)) revert StratoBlockNotAnchored();

        // 2. MPT-verify the receipt against the anchored root.
        bytes memory trieKey = _rlpEncodeStratoTxIndex(txIndex);
        if (!MerklePatricia.verifyInclusion(receiptsRoot, trieKey, receiptRLP, mptProof)) {
            revert ProofVerificationFailed();
        }

        // 3. Decode the log into typed form.
        STRATOEventDecoder.DecodedNativeWithdrawal memory d =
            STRATOEventDecoder.decodeNativeWithdrawalLog(receiptRLP, logIndex);

        // 4. Source-side validation: the log must come from the
        //    canonical StratoNativeBridge and carry the right event.
        if (d.contractAddress != stratoNativeBridge) revert WrongSourceBridge();
        if (d.eventNameHash != nativeWithdrawalEventNameHash) revert UnexpectedEventName();

        // 5. Destination-side validation: STRATO can mint for many
        //    chains; only honor logs whose destination matches us.
        if (d.externalChainId != block.chainid) revert WrongDestinationChain();
        if (d.externalBridge != address(this)) revert WrongDestinationBridge();

        // 6. Token-mapping validation. Must match the registered
        //    (stratoToken → representationToken) route and the route
        //    must be active.
        address mappedRepresentationToken = stratoToRepresentation[d.stratoToken];
        if (mappedRepresentationToken == address(0)) revert TokenNotMapped();
        if (mappedRepresentationToken != d.representationToken) revert RepresentationMismatch();
        if (!routeActive[d.stratoToken]) revert RouteDisabled();
        if (d.stratoTokenAmount == 0) revert ZeroAmount();

        // 7. Dedup against the same key the attestation path uses —
        //    one withdrawalId on STRATO maps to at most one mint here,
        //    regardless of which submission path got there first.
        bytes32 mintId = keccak256(
            abi.encode(stratoSourceChainId, stratoNativeBridge, d.withdrawalId)
        );
        if (processedMints[mintId]) revert DuplicateMint();
        processedMints[mintId] = true;

        // 8. Mint to the recipient encoded in the event.
        StratoNativeRepresentationToken(d.representationToken).mint(
            d.externalRecipient,
            d.stratoTokenAmount
        );

        emit RepresentationMintedTrustlessly(
            stratoBlockNumber,
            txIndex,
            logIndex,
            d.stratoToken,
            d.representationToken,
            d.externalRecipient,
            d.stratoTokenAmount,
            mintId
        );
        // Also emit the canonical {RepresentationMinted} so indexers
        // that only watch the v1 event still see the trustless mint.
        emit RepresentationMinted(
            stratoSourceChainId,
            stratoNativeBridge,
            d.withdrawalId,
            d.stratoToken,
            d.representationToken,
            d.externalRecipient,
            d.stratoTokenAmount,
            mintId
        );
    }

    /// @dev Minimal RLP encoder for the trie key. STRATO's receipts
    ///      trie keys txs by `rlp(txIndex)` — same shape as Ethereum.
    ///      Mirrors {BridgeVault._rlpEncodeTxIndex}.
    function _rlpEncodeStratoTxIndex(uint256 txIndex) private pure returns (bytes memory) {
        if (txIndex == 0) return hex"80";
        if (txIndex < 0x80) return abi.encodePacked(uint8(txIndex));
        uint256 v = txIndex;
        uint256 len;
        while (v != 0) {
            v >>= 8;
            ++len;
        }
        bytes memory out = new bytes(1 + len);
        out[0] = bytes1(uint8(0x80 + len));
        v = txIndex;
        for (uint256 i = len; i > 0; --i) {
            out[i] = bytes1(uint8(v & 0xff));
            v >>= 8;
        }
        return out;
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

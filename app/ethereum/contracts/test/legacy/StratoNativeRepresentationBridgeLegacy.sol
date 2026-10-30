// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
// Frozen pre-solver storage layout used by the deployed native bridge.
contract StratoNativeRepresentationBridgeLegacy is
    Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable,
    PausableUpgradeable, EIP712Upgradeable, UUPSUpgradeable
{
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
    mapping(uint256 => bool) public refundedRedemptions;
    mapping(bytes32 => bool) public canceledMints;

    function initialize(address admin) external initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __EIP712_init("StratoNativeRepresentationBridge", "1");
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}

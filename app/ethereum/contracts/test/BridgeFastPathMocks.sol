// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../bridge/BridgeFeeDecay.sol";

/// @dev BridgeFeeDecay is a library of internal functions, so a test cannot
///      call it directly. This exposes it, and nothing else uses it.
contract BridgeFeeDecayHarness {
    function decayedFee(
        uint256 maxFee,
        uint256 requestedAt,
        uint256 halfLife,
        uint256 at
    ) external pure returns (uint256) {
        return BridgeFeeDecay.decayedFee(maxFee, requestedAt, halfLife, at);
    }

    function isFeeCapAllowed(
        uint256 maxFee,
        uint256 amount,
        uint256 maxFeeBps
    ) external pure returns (bool) {
        return BridgeFeeDecay.isFeeCapAllowed(maxFee, amount, maxFeeBps);
    }

    function isHalfLifeAllowed(uint256 halfLife) external pure returns (bool) {
        return BridgeFeeDecay.isHalfLifeAllowed(halfLife);
    }

    function window() external pure returns (uint256) {
        return BridgeFeeDecay.DECAY_WINDOW_SECONDS;
    }
}

/// @dev A plain ERC20 for bond and fill inventory in the fast-path tests.
contract MockFastPathToken is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

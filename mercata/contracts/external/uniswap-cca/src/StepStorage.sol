// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IStepStorage} from './interfaces/IStepStorage.sol';
import {ConstantsLib} from './libraries/ConstantsLib.sol';
import {AuctionStep, StepLib} from './libraries/StepLib.sol';

/// @title StepStorage
/// @notice Abstract contract to store and read information about the auction issuance schedule
abstract contract StepStorage is IStepStorage {
    struct AuctionStepInput {
        uint24 mps;
        uint40 blockDelta;
    }

    /// @notice The block at which the auction starts
    uint64 internal immutable START_BLOCK;
    /// @notice The block at which the auction ends
    uint64 internal immutable END_BLOCK;
    /// @notice Number of auction step entries provided in the constructor
    uint256 internal immutable _STEP_COUNT;

    /// @notice Decoded auction step inputs
    AuctionStepInput[] private _auctionSteps;
    /// @notice The index of the next decoded step to be activated
    uint256 private _nextStepIndex;
    /// @notice The current active auction step
    AuctionStep internal _step;

    constructor(bytes memory _auctionStepsData, uint64 _startBlock, uint64 _endBlock) {
        require(_startBlock < _endBlock, "StepStorage: invalid end block");
        START_BLOCK = _startBlock;
        END_BLOCK = _endBlock;
        if (_auctionStepsData.length == 0 || _auctionStepsData.length % StepLib.UINT64_SIZE != 0) {
            revert("StepStorage: invalid auction data length");
        }
        _STEP_COUNT = _auctionStepsData.length / StepLib.UINT64_SIZE;

        uint256 sumMps = 0;
        uint64 sumBlockDelta = 0;
        for (uint256 i = 0; i < _auctionStepsData.length; i += StepLib.UINT64_SIZE) {
            (uint24 mps, uint40 blockDelta) = StepLib.get(_auctionStepsData, i);
            require(blockDelta != 0, "StepStorage: block delta=0");
            sumMps += mps * blockDelta;
            sumBlockDelta += blockDelta;
            _auctionSteps.push(AuctionStepInput({mps: mps, blockDelta: blockDelta}));
        }
        require(sumMps == ConstantsLib.MPS, "StepStorage: invalid total mps");
        uint64 calculatedEndBlock = START_BLOCK + sumBlockDelta;
        require(calculatedEndBlock == END_BLOCK, "StepStorage: step data end block mismatch");

        _advanceStep();
    }

    /// @notice Advance the current auction step
    /// @dev This function is called on every new bid if the current step is complete
    function _advanceStep() internal returns (AuctionStep memory) {
        require(_nextStepIndex < _STEP_COUNT, "StepStorage: auction is over");

        AuctionStepInput storage auctionStepInput_ = _auctionSteps[_nextStepIndex];
        uint24 mps = auctionStepInput_.mps;
        uint40 blockDelta = auctionStepInput_.blockDelta;

        uint64 _startBlock = _step.endBlock;
        if (_startBlock == 0) _startBlock = START_BLOCK;
        uint64 _endBlock = _startBlock + uint64(blockDelta);

        _step = AuctionStep({startBlock: _startBlock, endBlock: _endBlock, mps: mps});
        _nextStepIndex++;

        emit AuctionStepRecorded(_startBlock, _endBlock, mps);
        return _step;
    }

    /// @inheritdoc IStepStorage
    function step() external view override returns (AuctionStep memory) {
        return _step;
    }

    // Getters
    /// @inheritdoc IStepStorage
    function pointer() external view override returns (address) {
        return address(0);
    }
}

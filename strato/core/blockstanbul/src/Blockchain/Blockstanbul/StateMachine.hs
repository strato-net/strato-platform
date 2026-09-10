{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Blockstanbul.StateMachine where

import BlockApps.Logging
import Blockchain.Blockstanbul.Messages
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.ProposerSelection
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Conduit
import Control.DeepSeq (NFData)
import Control.Lens hiding (view)
import Control.Monad
import Control.Monad.Composable.Vault
import Control.Monad.State.Class
import GHC.Generics (Generic)
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import Text.Format
import Text.ShortDescription
import Prelude hiding (round, sequence)

class Monad m => HasBlockstanbulContext m where
  getBlockstanbulContext :: m BlockstanbulContext
  putBlockstanbulContext :: BlockstanbulContext -> m ()

type StateMachineM m =
  ( MonadState BlockstanbulContext m,
    MonadIO m,
    MonadLogger m,
    HasVault m
  )

data NextType = Round RoundNumber | Sequence SequenceNumber

data BlockstanbulContext = BlockstanbulContext
  { -- view describes which consensus round is under consideration.
    _view :: View,
    -- Whether to really authenticate, or just to pretend to.
    _productionAuth :: Bool,
    -- The latest block created by this peer
    _myBlock :: Maybe Block,
    -- The block proposed for this round
    _proposal :: Maybe Block,
    -- The designated participant to suggest a block for this round
    _proposer :: Validator,
    -- The total group of participants
    _validators :: S.Set Validator,
    -- Stake weights in force for the next block (validators absent here weigh 0)
    _stakes :: M.Map Validator Integer,
    -- Block number from which stake-weighted, per-height proposer selection is
    -- in force (Nothing = from genesis)
    _stakingActivation :: Maybe Integer,
    -- Network id, part of the proposer selection seed
    _chainId :: Integer,
    -- PBFT round of the last committed block: rounds persist across heights,
    -- so this is the round the next height starts at
    _lastRound :: Integer,
    -- Validators who have sent us a prepare for this round
    _prepared :: M.Map Validator Keccak256,
    -- Validators who have sent us a commitment seal for this round
    _committed :: M.Map Validator (Keccak256, Signature),
    -- We've already sent out a commit message to indicate a transition
    -- to prepared
    _hasPreprepared :: Bool,
    _hasPrepared :: Bool,
    _hasCommitted :: Bool,
    _pendingRound :: Maybe RoundNumber,
    -- Which peers have we received a notice for a round-change
    _roundChanged :: M.Map RoundNumber (S.Set Validator),
    -- The identity of this node
    _selfAddr :: Maybe Address,
    -- Block locking: a safety mechanism to prevent partial commits
    _blockLock :: Maybe Block,
    _lockSender :: Maybe Validator,
    -- TODO(tim): Initialize _lastParent with the genesis block and
    -- make it required
    _lastParent :: Maybe Keccak256,
    -- Validator characteristics
    _validatorBehavior :: Bool,
    _isValidator :: Bool,
    _network :: String
  }
  deriving (Generic, NFData)

makeLenses ''BlockstanbulContext

-- | Is stake-weighted selection in force for the given block number?
stakingActiveFor :: Integer -> BlockstanbulContext -> Bool
stakingActiveFor height ctx = maybe True (height >=) (_stakingActivation ctx)

-- | Height of the block currently under consideration.
nextHeight :: BlockstanbulContext -> Integer
nextHeight ctx = fromIntegral (_sequence $ _view ctx) + 1

-- | Is stake-weighted selection in force for the block under consideration?
stakingActiveNow :: BlockstanbulContext -> Bool
stakingActiveNow ctx = stakingActiveFor (nextHeight ctx) ctx

-- | The proposer for the current view. Stake-weighted and per-height (seeded by
-- chain id, height and round) once staking is active; the legacy
-- address-ordered round-robin (sticky across heights) before that.
computeLeader :: BlockstanbulContext -> Validator
computeLeader ctx
  | S.null vals = error "computeLeader: you need at least one validator in the network"
  | stakingActiveFor height ctx =
      selectProposer (_chainId ctx) height vals (_stakes ctx) (_lastRound ctx) (fromIntegral rnd)
  | otherwise = (fromIntegral rnd `mod` S.size vals) `S.elemAt` vals
  where
    vals = _validators ctx
    height = nextHeight ctx
    rnd = _round $ _view ctx

debugShowCtx :: StateMachineM m => m ()
debugShowCtx = do
  let debugLog :: (StateMachineM m2) => T.Text -> LensLike' (Const (m2 ())) BlockstanbulContext a -> (a -> String) -> m2 ()
      debugLog loc lns f = join . uses lns $ $logDebugS loc . T.pack . f
  debugLog "showctx/view" view format
  debugLog "showctx/proposer" proposer ((++ "\n") . format)
  debugLog "showctx/validators" validators (shortDescription . S.toList)
  debugLog "showctx/stakes" stakes show
  debugLog "showctx/lastParent" lastParent (maybe "Nothing" format)
  debugLog "showctx/lastRound" lastRound show
  debugLog "showctx/mBlockNumber" proposal (show . fmap (number . blockBlockData))
  debugLog "showctx/mLockedBlockNo" blockLock (show . fmap (number . blockBlockData))
  debugLog "showctx/mLockedSender" lockSender (show . fmap format)
  debugLog "showctx/isValidator" isValidator show
  debugLog "showctx/prepared" prepared show
  debugLog "showctx/committed" committed show
  debugLog "showctx/hasPrepared" hasPrepared show
  debugLog "showctx/roundChanged" roundChanged show

newContext :: String -> Integer -> Checkpoint -> Maybe Address -> Bool -> Maybe Integer -> BlockstanbulContext
newContext network' chainId' (Checkpoint v as mParent stakes' lastRound') addr valB activation =
  let valSet = S.fromList as
      ctx = BlockstanbulContext
        { _view = v,
          _productionAuth = True,
          _myBlock = Nothing,
          _proposal = Nothing,
          _proposer = computeLeader ctx,
          _validators = valSet,
          _stakes = M.fromList stakes',
          _stakingActivation = activation,
          _chainId = chainId',
          _lastRound = lastRound',
          _prepared = M.empty,
          _committed = M.empty,
          _hasPreprepared = False,
          _hasPrepared = False,
          _hasCommitted = False,
          _pendingRound = Nothing,
          _roundChanged = M.empty,
          _selfAddr = addr,
          _blockLock = Nothing,
          _lockSender = Nothing,
          _lastParent = mParent,
          _validatorBehavior = valB,
          _isValidator = maybe False (\a -> Validator a `S.member` valSet) addr,
          _network = network'
        }
   in ctx

generateNonceMap :: [Validator] -> M.Map Validator Int
generateNonceMap = M.fromList . flip zip (repeat 0)

-- | Voting weights of a validator set for quorum purposes: the published stake
-- weights once staking is active (members without stake weigh 0, so they count on
-- neither side; if nobody has stake yet every member weighs 1), one each before.
voteWeights :: Bool -> S.Set Validator -> M.Map Validator Integer -> M.Map Validator Integer
voteWeights weighted vals stakeMap
  | weighted && any (> 0) (M.elems staked) = staked
  | otherwise = M.fromSet (const 1) vals
  where staked = M.fromSet (\v -> max 0 (M.findWithDefault 0 v stakeMap)) vals

-- | @3 * voteWeight voters > 2 * totalWeight@: the PBFT supermajority.
hasSupermajority :: M.Map Validator Integer -> S.Set Validator -> Bool
hasSupermajority weights voters = 3 * weightOf weights voters > 2 * sum (M.elems weights)

-- | @3 * voteWeight voters > totalWeight@: more than a third (round-change piggyback).
hasMinority :: M.Map Validator Integer -> S.Set Validator -> Bool
hasMinority weights voters = 3 * weightOf weights voters > sum (M.elems weights)

weightOf :: M.Map Validator Integer -> S.Set Validator -> Integer
weightOf weights voters = sum [w | (v, w) <- M.toList weights, v `S.member` voters]

-- | Quorum weights for the height under consideration.
currentVoteWeights :: BlockstanbulContext -> M.Map Validator Integer
currentVoteWeights ctx = voteWeights (stakingActiveNow ctx) (_validators ctx) (_stakes ctx)

clearLock :: (StateMachineM m) => m ()
clearLock = do
  blockLock .= Nothing
  lockSender .= Nothing

setLock :: StateMachineM m => m ()
setLock = do
  (blockLock .=) =<< use proposal
  (lockSender .=) =<< uses proposer Just

{-# LANGUAGE ConstraintKinds #-}
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
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Conduit
import Control.Lens hiding (view)
import Control.Monad
import Control.Monad.State.Class
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Data.Set as S
import qualified Data.Text as T
import Text.Format
import Prelude hiding (round, sequence)

class Monad m => HasBlockstanbulContext m where
  getBlockstanbulContext :: m (Maybe BlockstanbulContext)
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
    -- The block proposed for this round
    _proposal :: Maybe Block,
    -- The designated participant to suggest a block for this round
    _proposer :: Validator,
    -- The total group of participants
    _validators :: S.Set Validator,
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
    _selfCert :: Maybe ChainMemberParsedSet,
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

makeLenses ''BlockstanbulContext

debugShowCtx :: StateMachineM m => m ()
debugShowCtx = do
  let debugLog :: (StateMachineM m2) => T.Text -> LensLike' (Const (m2 ())) BlockstanbulContext a -> (a -> String) -> m2 ()
      infoLog loc lns f = join . uses lns $ $logInfoS loc . T.pack . f
      debugLog loc lns f = join . uses lns $ $logDebugS loc . T.pack . f
  infoLog "showctx/view" view format
  infoLog "showctx/proposer" proposer ((++ "\n") . format)
  infoLog "showctx/validators" validators (show . map format . S.toList)
  infoLog "showctx/mBlockNumber" proposal (show . fmap (number . blockBlockData))
  infoLog "showctx/mLockedBlockNo" blockLock (show . fmap (number . blockBlockData))
  infoLog "showctx/mLockedSender" lockSender (show . fmap format)
  infoLog "showctx/isValidator" isValidator show
  debugLog "showctx/prepared" prepared show
  debugLog "showctx/committed" committed show
  debugLog "showctx/hasPrepared" hasPrepared show
  debugLog "showctx/roundChanged" roundChanged show

newContext :: String -> Checkpoint -> Maybe Address -> Bool -> Maybe ChainMemberParsedSet -> BlockstanbulContext
newContext network' (Checkpoint v as) addr valB chainm =
  let valSet = S.fromList as
      prop = fromMaybe (error "you need at least one validator in the network") $ S.lookupMin valSet
   in BlockstanbulContext
        { _view = v,
          _productionAuth = True,
          _proposal = Nothing,
          _proposer = prop,
          _validators = valSet,
          _prepared = M.empty,
          _committed = M.empty,
          _hasPreprepared = False,
          _hasPrepared = False,
          _hasCommitted = False,
          _pendingRound = Nothing,
          _roundChanged = M.empty,
          _selfAddr = addr,
          _selfCert = chainm,
          _blockLock = Nothing,
          _lockSender = Nothing,
          _lastParent = Nothing,
          _validatorBehavior = valB,
          _isValidator = False,
          _network = network'
        }

generateNonceMap :: [Validator] -> M.Map Validator Int
generateNonceMap = M.fromList . flip zip (repeat 0)

poolSize :: (StateMachineM m) => m Int
poolSize = uses validators S.size

clearLock :: (StateMachineM m) => m ()
clearLock = do
  blockLock .= Nothing
  lockSender .= Nothing

setLock :: StateMachineM m => m ()
setLock = do
  (blockLock .=) =<< use proposal
  (lockSender .=) =<< uses proposer Just

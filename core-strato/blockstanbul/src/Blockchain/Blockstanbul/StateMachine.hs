{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleInstances #-}

module Blockchain.Blockstanbul.StateMachine where 


import           Conduit
import           Control.Lens                     hiding (view)
import           Control.Monad     
import           Control.Monad.State.Class

import qualified Data.Map.Strict                  as M
import           Data.Maybe
import qualified Data.Set                         as S
import qualified Data.Text                        as T
import           Prelude                          hiding (round, sequence)
import           Text.Printf
import           Text.Format


import           Blockchain.Blockstanbul.Messages
import           Blockchain.Data.Address
import           Blockchain.Data.Block
import           Blockchain.Data.BlockDB
import           Blockchain.Output
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Secp256k1


class Monad m => HasBlockstanbulContext m where
  getBlockstanbulContext :: m (Maybe BlockstanbulContext)
  putBlockstanbulContext :: BlockstanbulContext -> m ()


type StateMachineM m = ( MonadState BlockstanbulContext m
                       , MonadIO m
                       , MonadLogger m
                       , HasVault m
                       )


data NextType = Round RoundNumber | Sequence SequenceNumber

data BlockstanbulContext = BlockstanbulContext {
  -- view describes which consensus round is under consideration.
    _view :: View
  -- Whether to really authenticate, or just to pretend to.
  , _productionAuth :: Bool
  -- The block proposed for this round
  , _proposal :: Maybe Block
  -- The designated participant to suggest a block for this round
  , _proposer :: Address
  -- The total group of participants
  , _validators :: S.Set Address
  -- Validators who have sent us a prepare for this round
  , _prepared :: M.Map Address Keccak256
  -- Validators who have sent us a commitment seal for this round
  , _committed :: M.Map Address (Keccak256, Signature)
  -- We've already sent out a commit message to indicate a transition
  -- to prepared
  , _hasPreprepared :: Bool
  , _hasPrepared :: Bool
  , _hasCommitted :: Bool
  , _pendingRound :: Maybe RoundNumber
  -- Which peers have we received a notice for a round-change
  , _roundChanged :: M.Map RoundNumber (S.Set Address)
  , _voted :: M.Map Address (M.Map Address Bool)
  -- The address of this node
  , _selfAddr :: Address
  -- Block locking: a safety mechanism to prevent partial commits
  , _blockLock :: Maybe Block
  , _lockSender :: Maybe Address
  , _authSenders :: M.Map Address Int
  -- TODO(tim): Initialize _lastParent with the genesis block and
  -- make it required
  , _lastParent :: Maybe Keccak256
}
makeLenses ''BlockstanbulContext



debugShowCtx :: StateMachineM m => m ()
debugShowCtx = do
  let debugLog :: (StateMachineM m2) => T.Text -> LensLike' (Const (m2 ())) BlockstanbulContext a -> (a -> String) -> m2 ()
      infoLog loc lns f = join . uses lns $ $logInfoS loc . T.pack . f
      debugLog loc lns f = join . uses lns $ $logDebugS loc . T.pack . f
  infoLog "showctx/view" view format
  infoLog "showctx/proposer" proposer (printf "%x")
  infoLog "showctx/validators" validators (show . map (printf "%x" :: Address -> String) . S.toList)
  infoLog "showctx/mBlockNumber" proposal (show . fmap (blockDataNumber . blockBlockData))
  infoLog "showctx/mLockedBlockNo" blockLock (show . fmap (blockDataNumber . blockBlockData))
  infoLog "showctx/mLockedSender" lockSender (show . fmap format)
  debugLog "showctx/prepared" prepared show
  debugLog "showctx/committed" committed show
  debugLog "showctx/hasPrepared" hasPrepared show
  debugLog "showctx/roundChanged" roundChanged show
  debugLog "showctx/admins" authSenders show

newContext :: Checkpoint -> Address -> BlockstanbulContext
newContext (Checkpoint v pendingVotes as senderlist) addr =
  let valSet = S.fromList as
      prop = fromMaybe 0x0 . S.lookupMin $ valSet
  in BlockstanbulContext
     { _view = v
     , _productionAuth = True
     , _proposal = Nothing
     , _proposer = prop
     , _validators = valSet
     , _prepared = M.empty
     , _committed = M.empty
     , _hasPreprepared = False
     , _hasPrepared = False
     , _hasCommitted = False
     , _pendingRound = Nothing
     , _roundChanged = M.empty
     , _voted = pendingVotes
     , _selfAddr = addr
     , _blockLock = Nothing
     , _lockSender = Nothing
     , _authSenders = generateNonceMap senderlist
     , _lastParent = Nothing
     }

generateNonceMap :: [Address] -> M.Map Address Int
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


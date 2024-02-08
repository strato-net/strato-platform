{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.EVM.VMState
  ( VMState (..),
    Gas,
    action,
    Memory (..),
    startingState,
    DebugCallCreate (..),
  )
where

import Blockchain.Data.Log
import Blockchain.EVM.Environment
import qualified Blockchain.EVM.MutableStack as MS
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Stream.Action (Action)
import qualified Blockchain.Stream.Action as Action
import Blockchain.VMContext
import Control.DeepSeq
import Control.Lens hiding (Context)
import Control.Monad
import qualified Data.ByteString as B
import Data.IORef
import Data.IORef.Unboxed
import qualified Data.Map.Ordered as OMap
import qualified Data.Sequence as Seq
import qualified Data.Set as S
import qualified Data.Vector.Storable.Mutable as V
import Data.Word
import GHC.Generics
import Text.Format

instance Show Counter where
  show = const "<unboxed_ioref>"

instance NFData Counter where
  rnf = (`seq` ())

data Memory = Memory
  { mVector :: V.IOVector Word8,
    mSize :: IORef Int
  }
  deriving (Generic, NFData)

instance Show Memory where
  show = const "<memory>"

newMemory :: IO Memory
newMemory = do
  arr <- V.new 100
  size <- newIORef 0
  forM_ [0 .. 99] $ \p -> V.write arr p 0
  return $ Memory arr size

data DebugCallCreate = DebugCallCreate
  { ccData :: B.ByteString,
    ccDestination :: Maybe Account,
    ccGasLimit :: Gas,
    ccValue :: Integer
  }
  deriving (Show, Eq, Generic, NFData)

--TODO- gas and refund use Counter for performance reasons, but this is based on Int, which could overflow....  in practice this should not matter, as gas values are bounded by what the user has in the account, which will always be low, but we should keep an eye on this if we change the nature of how gas works
data VMState = VMState
  { vmIsHomestead :: Bool,
    vmMemDBs :: MemDBs,
    vmGasRemaining :: Counter,
    pc :: Counter,
    memory :: Memory,
    stack :: MS.MutableStack Word256,
    callDepth :: Int,
    refund :: Counter,
    suicideList :: S.Set Account,
    done :: Bool,
    returnVal :: Maybe B.ByteString,
    theTrace :: [String],
    logs :: [Log],
    environment :: Environment,
    writable :: Bool, -- Whether to throw on attempted changes to storage
    _action :: Action,
    --These last two variable are only used for the Ethereum tests.
    isRunningTests :: Bool,
    debugCallCreates :: Maybe [DebugCallCreate]
  }
  deriving (Show, Generic, NFData)

makeLenses ''VMState

instance Format VMState where
  format VMState {..} =
    "pc: " ++ show pc ++ "\n"
      ++ "done: "
      ++ show done
      ++ "\n"
      ++ "gasRemaining: "
      ++ show vmGasRemaining
      ++ "\n"
      ++ "stack: "
      ++ show stack
      ++ "\n"

startingAction :: Environment -> Action
startingAction Environment {..} =
  Action.Action
    { _blockHash = blockHeaderHash envBlockHeader,
      _blockTimestamp = blockHeaderTimestamp envBlockHeader,
      _blockNumber = blockHeaderBlockNumber envBlockHeader,
      _transactionHash = envTxHash,
      _transactionChainId = envChainId,
      _transactionSender = envSender,
      _actionData = OMap.empty,
      _metadata = envMetadata,
      _events = Seq.empty,
      _delegatecalls = Seq.empty
    }

startingState :: Bool -> Bool -> Environment -> MemDBs -> IO VMState
startingState isRunningTests' isHomestead env dbs' = do
  m <- newMemory
  pcref <- newCounter 0
  gasref <- newCounter 0
  refundref <- newCounter 0
  stackHandle <- MS.empty
  return
    VMState
      { vmIsHomestead = isHomestead,
        vmMemDBs = dbs',
        pc = pcref,
        done = False,
        returnVal = Nothing,
        writable = True,
        vmGasRemaining = gasref,
        stack = stackHandle,
        memory = m,
        callDepth = 0,
        refund = refundref,
        theTrace = [],
        logs = [],
        environment = env,
        suicideList = S.empty,
        _action = startingAction env,
        --only used for running ethereum tests
        isRunningTests = isRunningTests',
        debugCallCreates = Nothing
      }

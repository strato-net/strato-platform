{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.EVM.VMState (
  VMState(..),
  Gas,
  action,
  Memory(..),
  startingState,
  DebugCallCreate(..),
  ) where

import           Control.DeepSeq
import           Control.Lens                 hiding (Context)
import           Control.Monad
import qualified Data.ByteString              as B
import           Data.IORef
import           Data.IORef.Unboxed
import qualified Data.Map.Strict              as M
import qualified Data.Set                     as S
import qualified Data.Vector.Storable.Mutable as V
import           Data.Word
import           GHC.Generics

import           Blockchain.Strato.Model.Action
import           Blockchain.Data.Address
import           Blockchain.Data.Log
import           Blockchain.EVM.Environment
import qualified Blockchain.EVM.MutableStack as MS
import           Blockchain.ExtWord
import           Blockchain.Strato.Model.Class
import           Blockchain.VMContext
import           Text.Format

type Gas = Int

instance Show Counter where
  show = const "<unboxed_ioref>"

instance NFData Counter where
  rnf = (`seq` ())

data Memory =
  Memory {
    mVector :: V.IOVector Word8,
    mSize   :: IORef Int
    } deriving (Generic, NFData)

instance Show Memory where
  show = const "<memory>"

newMemory :: IO Memory
newMemory = do
  arr <- V.new 100
  size <- newIORef 0
  forM_ [0..99] $ \p -> V.write arr p 0
  return $ Memory arr size

data DebugCallCreate =
  DebugCallCreate {
    ccData        :: B.ByteString,
    ccDestination :: Maybe Address,
    ccGasLimit    :: Gas,
    ccValue       :: Integer
    } deriving (Show, Eq, Generic, NFData)

data VMState =
  VMState {
    vmIsHomestead    :: Bool,
    dbs              :: Context,
    sqldb            :: Config,
    vmGasRemaining   :: Counter,
    pc               :: Counter,
    memory           :: Memory,
    stack            :: MS.MutableStack Word256,
    callDepth        :: Int,
    refund           :: Counter,

    suicideList      :: S.Set Address,
    done             :: Bool,
    returnVal        :: Maybe B.ByteString,

    theTrace         :: [String],
    logs             :: [Log],

    environment      :: Environment,

    writable         :: Bool, -- Whether to throw on attempted changes to storage

    _action          :: Action,

    --These last two variable are only used for the Ethereum tests.
    isRunningTests   :: Bool,
    debugCallCreates :: Maybe [DebugCallCreate]

    } deriving (Show, Generic, NFData)
makeLenses ''VMState


instance Format VMState where
  format state =
    "pc: " ++ show (pc state) ++ "\n" ++
    "done: " ++ show (done state) ++ "\n" ++
    "gasRemaining: " ++ show (vmGasRemaining state) ++ "\n" ++
    "stack: " ++ show (stack state) ++ "\n"

startingAction :: Environment -> Action
startingAction Environment{..} = Action
  { _actionBlockHash          = blockHeaderHash envBlockHeader
  , _actionBlockTimestamp     = blockHeaderTimestamp envBlockHeader
  , _actionBlockNumber        = blockHeaderBlockNumber envBlockHeader
  , _actionTransactionHash    = envTxHash
  , _actionTransactionChainId = envChainId
  , _actionTransactionSender  = envSender
  , _actionData               = M.empty
  , _actionMetadata           = envMetadata
  }

startingState :: Bool -> Bool -> Environment -> Config -> Context -> IO VMState
startingState isRunningTests' isHomestead env sqldb' dbs' = do
  m <- newMemory
  pcref <- newCounter 0
  gasref <- newCounter 0
  refundref <- newCounter 0
  stackHandle <- MS.empty
  return VMState
             {
               vmIsHomestead=isHomestead,
               dbs = dbs',
               sqldb = sqldb',
               pc = pcref,
               done=False,
               returnVal=Nothing,
               writable=True,
               vmGasRemaining=gasref,
               stack=stackHandle,
               memory=m,
               callDepth=0,
               refund=refundref,
               theTrace=[],
               logs=[],
               environment=env,
               suicideList=S.empty,
               _action = startingAction env,

               --only used for running ethereum tests
               isRunningTests=isRunningTests',
               debugCallCreates=Nothing
             }

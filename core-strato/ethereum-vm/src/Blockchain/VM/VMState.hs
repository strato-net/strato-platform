{-# LANGUAGE TemplateHaskell #-}

module Blockchain.VM.VMState (
  VMState(..),
  storageDiffs,
  smorgs,
  Memory(..),
  startingState,
  DebugCallCreate(..),
  ) where

import           Control.Lens                 hiding (Context)
import           Control.Monad
import qualified Data.ByteString              as B
import           Data.IORef
import qualified Data.Map.Strict              as M
import qualified Data.Set                     as S
import qualified Data.Vector.Storable.Mutable as V
import           Data.Word


import           Blockchain.Data.Address
import           Blockchain.Data.ExecResults
import           Blockchain.Data.Log
import           Blockchain.ExtWord
import           Blockchain.Format
import           Blockchain.VM.Environment
import           Blockchain.VMContext
import           Blockchain.VM.VMException

data Memory =
  Memory {
    mVector :: V.IOVector Word8,
    mSize   :: IORef Word256
    }


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
    ccGasLimit    :: Integer,
    ccValue       :: Integer
    } deriving (Show, Eq)

data VMState =
  VMState {
    vmIsHomestead    :: Bool,
    dbs              :: Context,
    vmGasRemaining   :: Integer,
    pc               :: Word256,
    memory           :: Memory,
    stack            :: [Word256],
    callDepth        :: Int,
    refund           :: Integer,

    suicideList      :: S.Set Address,
    done             :: Bool,
    returnVal        :: Maybe B.ByteString,

    theTrace         :: [String],
    logs             :: [Log],

    environment      :: Environment,

    vmException      :: Maybe VMException,

    writable         :: Bool, -- Whether to throw on attempted changes to storage

    _smorgs          :: [VMSmorgasburg],
    _storageDiffs    :: M.Map Address (M.Map Word256 Word256),

    --These last two variable are only used for the Ethereum tests.
    isRunningTests   :: Bool,
    debugCallCreates :: Maybe [DebugCallCreate]

    }
makeLenses ''VMState


instance Format VMState where
  format state =
    "pc: " ++ show (pc state) ++ "\n" ++
    "done: " ++ show (done state) ++ "\n" ++
    "gasRemaining: " ++ show (vmGasRemaining state) ++ "\n" ++
    "stack: " ++ show (stack state) ++ "\n"

startingState :: Bool->Bool->Environment->Context->IO VMState
startingState isRunningTests' isHomestead env dbs' = do
  m <- newMemory
  return VMState
             {
               vmIsHomestead=isHomestead,
               dbs = dbs',
               pc = 0,
               done=False,
               returnVal=Nothing,
               vmException=Nothing,
               writable=True,
               vmGasRemaining=0,
               stack=[],
               memory=m,
               callDepth=0,
               refund=0,
               theTrace=[],
               logs=[],
               environment=env,
               suicideList=S.empty,
               _smorgs = [],
               _storageDiffs = M.empty,

               --only used for running ethereum tests
               isRunningTests=isRunningTests',
               debugCallCreates=Nothing
             }

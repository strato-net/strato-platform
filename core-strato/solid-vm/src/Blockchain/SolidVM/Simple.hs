{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
module Blockchain.SolidVM.Simple
  ( SolidVM.SolidVMBase
  , SolidVMTxArgs(..)
  , argsBlockData
  , argsSender
  , argsOrigin
  , argsTxHash
  , argsChainId
  , argsMetadata
  , SolidVMCreateArgs(..)
  , createNewAddress
  , createCode
  , createArgs
  , SolidVMCallArgs(..)
  , callCodeAddress
  , callArgs
  , SolidVMTx(..)
  , _SolidVMCreate
  , _SolidVMCall
  , create
  , call
  , module Blockchain.Data.Code
  , module Blockchain.Data.DataDefs
  , module Blockchain.Data.ExecResults
  , module Blockchain.ExtWord
  , module Blockchain.Strato.Model.Account
  , module Blockchain.Strato.Model.Keccak256
  , module Blockchain.VM.SolidException
  , module Data.Default
  ) where

import           Control.Lens
import           Data.Default
import qualified Data.Map                          as M
import qualified Data.Text                         as T
import           Data.Time.Clock.POSIX
import           GHC.Generics
import           Blockchain.Data.Code
import           Blockchain.Data.DataDefs
import           Blockchain.Data.ExecResults
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.ExtWord
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Keccak256
import qualified Blockchain.SolidVM                as SolidVM
import           Blockchain.VM.SolidException

defaultBlockData :: BlockData
defaultBlockData = BlockData
    emptyHash
    emptyHash
    (Address 0)
    MP.emptyTriePtr
    MP.emptyTriePtr
    MP.emptyTriePtr
    ""
    0
    0
    0
    0
    (posixSecondsToUTCTime 0)
    ""
    0
    emptyHash

data SolidVMTxArgs = SolidVMTxArgs
  { _argsBlockData :: BlockData
  , _argsSender    :: Account
  , _argsOrigin    :: Account
  , _argsTxHash    :: Keccak256
  , _argsChainId   :: Maybe Word256
  , _argsMetadata  :: Maybe (M.Map T.Text T.Text)
  } deriving (Eq, Show, Generic)
makeLenses ''SolidVMTxArgs

instance Default SolidVMTxArgs where
  def = SolidVMTxArgs
    defaultBlockData
    (Account 0 Nothing)
    (Account 0 Nothing)
    emptyHash
    Nothing
    Nothing

data SolidVMCreateArgs = SolidVMCreateArgs
  { _createNewAddress :: Account
  , _createCode       :: Code
  , _createArgs       :: SolidVMTxArgs
  } deriving (Eq, Show, Generic)
makeLenses ''SolidVMCreateArgs

instance Default SolidVMCreateArgs where
  def = SolidVMCreateArgs
    (Account 0 Nothing)
    (Code "")
    def

data SolidVMCallArgs = SolidVMCallArgs
  { _callCodeAddress :: Account
  , _callArgs        :: SolidVMTxArgs
  } deriving (Eq, Show, Generic)
makeLenses ''SolidVMCallArgs

instance Default SolidVMCallArgs where
  def = SolidVMCallArgs
    (Account 0 Nothing)
    def

data SolidVMTx = SolidVMCreate SolidVMCreateArgs
               | SolidVMCall SolidVMCallArgs
               deriving (Eq, Show, Generic)
makePrisms ''SolidVMTx

err :: String -> String -> a
err func arg = error $ concat
  [ "Blockchain.SolidVM.Simple."
  , func
  , ": "
  , arg
  ]

createErr :: String -> a
createErr = err "create"

callErr :: String -> a
callErr = err "call"

create :: SolidVM.SolidVMBase m
       => SolidVMCreateArgs
       -> m ExecResults
create s = SolidVM.create
  (createErr "isRunningTests'")
  (createErr "isHomestead")
  (createErr "preExistingSuicideList")
  (s ^. createArgs . argsBlockData)
  (createErr "callDepth")
  (s ^. createArgs . argsSender)
  (s ^. createArgs . argsOrigin)
  (createErr "value")
  (createErr "gasPrice")
  (createErr "availableGas")
  (s ^. createNewAddress)
  (s ^. createCode)
  (s ^. createArgs . argsTxHash)
  (s ^. createArgs . argsChainId)
  (s ^. createArgs . argsMetadata)

call :: SolidVM.SolidVMBase m
     => SolidVMCallArgs
     -> m ExecResults
call s = SolidVM.call
  (callErr "isRunningTests'")
  (callErr "isHomestead")
  (callErr "noValueTransfer")
  (callErr "preExistingSuicideList")
  (s ^. callArgs . argsBlockData)
  (callErr "callDepth")
  (callErr "receiveAddress")
  (s ^. callCodeAddress)
  (s ^. callArgs . argsSender)
  (callErr "value")
  (callErr "gasPrice")
  (callErr "theData")
  (callErr "availableGas")
  (s ^. callArgs . argsOrigin)
  (s ^. callArgs . argsTxHash)
  (s ^. callArgs . argsChainId)
  (s ^. callArgs . argsMetadata)
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.SolidVM.Simple
  ( SolidVM.SolidVMBase,
    SolidVMTxArgs (..),
    argsBlockData,
    argsSender,
    argsOrigin,
    argsTxHash,
    argsChainId,
    argsMetadata,
    SolidVMCreateArgs (..),
    createNewAddress,
    createCode,
    createArgs,
    SolidVMCallArgs (..),
    callCodeAddress,
    callArgs,
    SolidVMTx (..),
    _SolidVMCreate,
    _SolidVMCall,
    create,
    call,
    module Blockchain.Strato.Model.Code,
    module Blockchain.Data.DataDefs,
    module Blockchain.Data.ExecResults,
    module Blockchain.Strato.Model.ExtendedWord,
    module Blockchain.Strato.Model.Account,
    module Blockchain.Strato.Model.Gas,
    module Blockchain.Strato.Model.Keccak256,
    module Blockchain.VM.SolidException,
    module Data.Default,
  )
where

import Blockchain.Data.BlockHeader
import Blockchain.Data.DataDefs
import Blockchain.Data.ExecResults
import qualified Blockchain.Database.MerklePatricia as MP
import qualified Blockchain.SolidVM as SolidVM
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256
import Blockchain.VM.SolidException
import Control.Lens
import Data.Default
import qualified Data.Map as M
import qualified Data.Text as T
import Data.Time.Clock.POSIX
import GHC.Generics

defaultBlockData :: BlockHeader
defaultBlockData =
  BlockHeader
    emptyHash
    emptyHash
    emptyChainMember
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
    emptyHash
    0

data SolidVMTxArgs = SolidVMTxArgs
  { _argsBlockData :: BlockHeader,
    _argsSender :: Account,
    _argsOrigin :: Account,
    _argsProposer :: Address,
    _argsTxHash :: Keccak256,
    _argsChainId :: Maybe Word256,
    _argsMetadata :: Maybe (M.Map T.Text T.Text)
  }
  deriving (Eq, Show, Generic)

makeLenses ''SolidVMTxArgs

instance Default SolidVMTxArgs where
  def =
    SolidVMTxArgs
      defaultBlockData
      (Account 0 Nothing)
      (Account 0 Nothing)
      (Address 0)
      emptyHash
      Nothing
      Nothing

data SolidVMCreateArgs = SolidVMCreateArgs
  { _createNewAddress :: Account,
    _createCode :: Code,
    _createArgs :: SolidVMTxArgs
  }
  deriving (Eq, Show, Generic)

makeLenses ''SolidVMCreateArgs

instance Default SolidVMCreateArgs where
  def =
    SolidVMCreateArgs
      (Account 0 Nothing)
      (Code "")
      def

data SolidVMCallArgs = SolidVMCallArgs
  { _callCodeAddress :: Account,
    _callArgs :: SolidVMTxArgs
  }
  deriving (Eq, Show, Generic)

makeLenses ''SolidVMCallArgs

instance Default SolidVMCallArgs where
  def =
    SolidVMCallArgs
      (Account 0 Nothing)
      def

data SolidVMTx
  = SolidVMCreate SolidVMCreateArgs
  | SolidVMCall SolidVMCallArgs
  deriving (Eq, Show, Generic)

makePrisms ''SolidVMTx

err :: String -> String -> a
err func arg =
  error $
    concat
      [ "Blockchain.SolidVM.Simple.",
        func,
        ": ",
        arg
      ]

createErr :: String -> a
createErr = err "create"

callErr :: String -> a
callErr = err "call"

create ::
  (SolidVM.SolidVMBase m) =>
  SolidVMCreateArgs ->
  m ExecResults
create s =
  SolidVM.create
    (createErr "isRunningTests'")
    (createErr "isHomestead")
    (createErr "preExistingSuicideList")
    (s ^. createArgs . argsBlockData)
    (createErr "callDepth")
    (s ^. createArgs . argsSender)
    (s ^. createArgs . argsOrigin)
    (s ^. createArgs . argsProposer)
    (createErr "value")
    (createErr "gasPrice")
    (Gas 100000000)
    (s ^. createNewAddress)
    (s ^. createCode)
    (s ^. createArgs . argsTxHash)
    (s ^. createArgs . argsChainId)
    (s ^. createArgs . argsMetadata)

call ::
  (SolidVM.SolidVMBase m) =>
  SolidVMCallArgs ->
  m ExecResults
call s =
  SolidVM.call
    (callErr "isRunningTests'")
    (callErr "isHomestead")
    (callErr "noValueTransfer")
    False
    (callErr "preExistingSuicideList")
    (s ^. callArgs . argsBlockData)
    (callErr "callDepth")
    (callErr "receiveAddress")
    (s ^. callCodeAddress)
    (s ^. callArgs . argsSender)
    (s ^. callArgs . argsProposer)
    (callErr "value")
    (callErr "gasPrice")
    (callErr "theData")
    (Gas 100000000)
    (s ^. callArgs . argsOrigin)
    (s ^. callArgs . argsTxHash)
    (s ^. callArgs . argsChainId)
    (s ^. callArgs . argsMetadata)

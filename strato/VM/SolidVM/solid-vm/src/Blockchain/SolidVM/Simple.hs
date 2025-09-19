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
    argsArgs,
    argsChainId,
    argsMetadata,
    SolidVMCreateArgs (..),
    createNewAddress,
    createContractName,
    createCode,
    createArgs,
    SolidVMCallArgs (..),
    callCodeAddress,
    callFuncName,
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
    0x0
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
    _argsSender :: Address,
    _argsOrigin :: Address,
    _argsProposer :: Address,
    _argsTxHash :: Keccak256,
    _argsArgs :: [T.Text],
    _argsChainId :: Maybe Word256,
    _argsMetadata :: Maybe (M.Map T.Text T.Text)
  }
  deriving (Eq, Show, Generic)

makeLenses ''SolidVMTxArgs

instance Default SolidVMTxArgs where
  def =
    SolidVMTxArgs
      defaultBlockData
      0
      0
      (Address 0)
      emptyHash
      []
      Nothing
      Nothing

data SolidVMCreateArgs = SolidVMCreateArgs
  { _createNewAddress :: Address,
    _createContractName :: T.Text,
    _createCode :: Code,
    _createArgs :: SolidVMTxArgs
  }
  deriving (Eq, Show, Generic)

makeLenses ''SolidVMCreateArgs

instance Default SolidVMCreateArgs where
  def =
    SolidVMCreateArgs
      0
      ""
      (Code "")
      def

data SolidVMCallArgs = SolidVMCallArgs
  { _callCodeAddress :: Address,
    _callFuncName :: T.Text,
    _callArgs :: SolidVMTxArgs
  }
  deriving (Eq, Show, Generic)

makeLenses ''SolidVMCallArgs

instance Default SolidVMCallArgs where
  def =
    SolidVMCallArgs
      0
      ""
      def

data SolidVMTx
  = SolidVMCreate SolidVMCreateArgs
  | SolidVMCall SolidVMCallArgs
  deriving (Eq, Show, Generic)

makePrisms ''SolidVMTx

create ::
  (SolidVM.SolidVMBase m) =>
  SolidVMCreateArgs ->
  m ExecResults
create s =
  SolidVM.create
    (s ^. createArgs . argsBlockData)
    (s ^. createArgs . argsSender)
    (s ^. createArgs . argsOrigin)
    (s ^. createArgs . argsProposer)
    (Gas 100000000)
    (s ^. createNewAddress)
    (s ^. createCode)
    (s ^. createArgs . argsTxHash)
    (s ^. createContractName)
    (s ^. createArgs . argsArgs)

call ::
  (SolidVM.SolidVMBase m) =>
  SolidVMCallArgs ->
  m ExecResults
call s =
  SolidVM.call
    False
    (s ^. callArgs . argsBlockData)
    (s ^. callCodeAddress)
    (s ^. callArgs . argsSender)
    (s ^. callArgs . argsProposer)
    (Gas 100000000)
    (s ^. callArgs . argsOrigin)
    (s ^. callArgs . argsTxHash)
    (s ^. callFuncName)
    (s ^. callArgs . argsArgs)
    Nothing

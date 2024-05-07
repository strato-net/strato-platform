{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}

{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.Data.TransactionResult
  ( TransactionResult,
    HasMemTXResultDB (..),
    putTransactionResult,
    putTransactionResults,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.SolidVM.Model
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.DeepSeq
import Data.Binary
import Data.Swagger hiding (Format, format)
import qualified Database.Persist.Postgresql as SQL
import qualified Generic.Random as GR
import Servant.Docs hiding (pretty)
import Test.QuickCheck
import Text.Format

instance Format TransactionResult where
  format TransactionResult {..} =
    "blockHash: " ++ format transactionResultBlockHash ++ "\n"
      ++ "transactionHash: "
      ++ format transactionResultTransactionHash
      ++ "\n"
      ++ "message: "
      ++ show transactionResultMessage
      ++ "\n"
      ++ "response: "
      ++ show transactionResultResponse
      ++ "\n"
      ++ "trace: "
      ++ show transactionResultTrace
      ++ "\n"
      ++ "gasUsed: "
      ++ format transactionResultGasUsed
      ++ "\n"
      ++ "etherUsed: "
      ++ format transactionResultEtherUsed
      ++ "\n"
      ++ "contractsCreated: "
      ++ show transactionResultContractsCreated
      ++ "\n"
      ++ "contractsDeleted: "
      ++ show transactionResultContractsDeleted
      ++ "\n"
      ++ "stateDiff: "
      ++ show transactionResultStateDiff
      ++ "\n"
      ++ "time: "
      ++ show transactionResultTime
      ++ "\n"
      ++ "newStorage: "
      ++ show transactionResultNewStorage
      ++ "\n"
      ++ "deletedStorage: "
      ++ show transactionResultDeletedStorage
      ++ "\n"
      ++ "status: "
      ++ show transactionResultStatus
      ++ "\n"
      ++ "chainId: "
      ++ format transactionResultChainId
      ++ "\n"
      ++ "kind: "
      ++ show transactionResultKind

instance NFData TransactionResult

instance Binary TransactionResult

instance Arbitrary TransactionResult where
  arbitrary = GR.genericArbitrary GR.uniform

instance ToSample TransactionResult where
  toSamples _ = singleSample exampleTxResult

exampleTxResult :: TransactionResult
exampleTxResult =
  TransactionResult
    (hash "blockHask")
    (hash "txhash")
    "I'm a tx result message"
    "05"
    "I'm a tx trace"
    (21 :: Word256)
    (42 :: Word256)
    "[MyNewContractA, MyNewContractB]"
    "[MyOldContract]"
    "I am a state Diff"
    0.2321
    "New Storage"
    "Deleted Storage"
    Nothing
    Nothing
    (Just SolidVM)
    "BlockApps"
    "Sample App"

instance ToSchema TransactionResult where
  declareNamedSchema _ =
    return $
      NamedSchema (Just "TransactionResult") mempty

class (Monad m) => HasMemTXResultDB m where
  enqueueTransactionResults :: [TransactionResult] -> m ()
  flushTransactionResults :: m ()

  enqueueTransactionResult :: TransactionResult -> m ()
  enqueueTransactionResult = enqueueTransactionResults . pure

putTransactionResult ::
  HasSQLDB m =>
  TransactionResult ->
  m (Key TransactionResult)
putTransactionResult = fmap head . putTransactionResults . pure

putTransactionResults ::
  HasSQLDB m =>
  [TransactionResult] ->
  m [Key TransactionResult]
putTransactionResults = sqlQuery . SQL.insertMany

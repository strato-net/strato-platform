{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}

{-# OPTIONS -fno-warn-orphans #-}

module Blockchain.Data.TransactionResult
  ( TransactionResult,
    putTransactionResult,
    putTransactionResults,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Control.Arrow ((&&&))
import Control.DeepSeq
import Data.Binary
import Data.Function (on)
import Data.Swagger hiding (Format, format)
import qualified Database.Persist.Postgresql as SQL
import qualified Generic.Random as GR
import Servant.Docs hiding (pretty)
import Test.QuickCheck
import Text.Format

instance Ord TransactionResult where
  compare = compare `on` (transactionResultBlockHash &&& transactionResultTransactionHash)

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
    [0x1, 0x2]
    [0x3]
    "I am a state Diff"
    0.2321
    "New Storage"
    "Deleted Storage"
    Nothing

instance ToSchema TransactionResult where
  declareNamedSchema _ =
    return $
      NamedSchema (Just "TransactionResult") mempty

putTransactionResult ::
  HasSQLDB m =>
  TransactionResult ->
  m (Key TransactionResult)
putTransactionResult = fmap unsafeHead . putTransactionResults . pure
  where unsafeHead []    = error "putTransactionResult: No keys returned"
        unsafeHead (x:_) = x

putTransactionResults ::
  HasSQLDB m =>
  [TransactionResult] ->
  m [Key TransactionResult]
putTransactionResults = sqlQuery . SQL.insertMany

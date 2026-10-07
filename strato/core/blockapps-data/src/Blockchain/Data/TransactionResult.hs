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
import qualified Data.Set as Set
import Control.Monad.IO.Class (MonadIO)
import Data.OpenApi hiding (Format, format)
import Data.Proxy (Proxy (..))
import qualified Data.Text as T
import Database.Persist (entityDef, fieldDB, getEntityDBName, getEntityFields, toPersistFields, unEntityNameDB, unFieldNameDB)
import qualified Database.Persist.Postgresql as SQL
import qualified Generic.Random as GR
import Servant.Docs hiding (pretty)
import SolidVM.Model.Value (Value(..))
import Test.QuickCheck
import Text.Format

-- Binary Value now lives in SolidVM.Model.Value alongside the type itself.

instance Arbitrary Value where
  arbitrary = pure $ SInteger 0

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
      ++ maybe "(void)" show transactionResultResponse
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
    (Just $ SInteger 5)
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
  m ()
putTransactionResult = putTransactionResults . pure

-- | Insert results that are not already present, keyed by
-- @(blockHash, transactionHash)@. slipstream consumes @vmevents@ at least
-- once, so a batch replayed after a crash (or after a standby core is
-- promoted and resumes from its progress marker) must not duplicate rows,
-- and at a lease handoff two writers can briefly overlap. The insert is
-- ON CONFLICT DO NOTHING against the unique index on the pair (see
-- DataDefs.indexAll), which settles any race in the database; the pre-read
-- (served by @transaction_result_transaction_hash_idx@) skips the common
-- replay cheaply and is all that remains on a database where the unique
-- index could not be built.
putTransactionResults ::
  HasSQLDB m =>
  [TransactionResult] ->
  m ()
putTransactionResults [] = pure ()
putTransactionResults trs = sqlQuery $ do
  existing <-
    SQL.selectList
      [TransactionResultTransactionHash SQL.<-. map transactionResultTransactionHash trs]
      []
  let resultKey r = (transactionResultBlockHash r, transactionResultTransactionHash r)
      seen = Set.fromList [resultKey r | SQL.Entity _ r <- existing]
  mapM_ insertIgnoringConflicts . chunks 500 $ filter ((`Set.notMember` seen) . resultKey) trs
  where
    chunks _ [] = []
    chunks n xs = let (h, t) = splitAt n xs in h : chunks n t

-- | @INSERT ... ON CONFLICT DO NOTHING@ for a batch of results. persistent's
-- insertMany has no conflict clause, so the statement is built from the
-- entity definition.
insertIgnoringConflicts :: MonadIO m => [TransactionResult] -> SQL.SqlPersistT m ()
insertIgnoringConflicts [] = pure ()
insertIgnoringConflicts rows =
  SQL.rawExecute
    ( "INSERT INTO " <> quote (unEntityNameDB (getEntityDBName def)) <> " (" <> T.intercalate "," cols <> ") VALUES "
        <> T.intercalate "," (replicate (length rows) placeholders) <> " ON CONFLICT DO NOTHING"
    )
    (concatMap toPersistFields rows)
  where
    def = entityDef (Proxy :: Proxy TransactionResult)
    cols = map (quote . unFieldNameDB . fieldDB) (getEntityFields def)
    placeholders = "(" <> T.intercalate "," (replicate (length cols) "?") <> ")"
    quote ident = "\"" <> ident <> "\""

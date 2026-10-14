{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE EmptyDataDecls #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE ForeignFunctionInterface #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE NoDeriveAnyClass #-}
{-# OPTIONS_GHC -fno-warn-name-shadowing #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.DataDefs where

--import BlockApps.Solidity.Xabi
import Blockchain.Data.PersistTypes ()
import Blockchain.Data.TXOrigin
import Blockchain.Data.TransactionResultStatus
import Blockchain.MiscJSON ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.StateRoot
import Blockchain.Strato.Model.Validator
import Control.DeepSeq
import Control.Monad.Trans.Class (lift)
import qualified Data.Binary as BIN
import qualified Data.ByteString as BS
import Data.Text (Text)
import qualified Data.Text as T
import Data.Time
import Data.Word
import Database.Persist.Quasi
import Database.Persist.Sql
import Database.Persist.TH
import Database.PostgreSQL.Simple (SqlError)
import GHC.Generics
import UnliftIO (catch, liftIO)
import SolidVM.Model.Storable
import SolidVM.Model.Value (Value)

share
  [mkPersist sqlSettings, mkMigrate "migrateAuto"] -- annoying: postgres doesn't like tables called user
  $(persistFileWith lowerCaseSettings "src/Blockchain/Data/DataDefs.txt")

migrateAll :: Migration
migrateAll = migrateAuto

indexAll :: Migration
indexAll = do
  let exec = lift . lift . flip rawExecute []
      execTolerant q = lift . lift $
        rawExecute q [] `catch` \(e :: SqlError) ->
          liftIO . putStrLn $ "indexAll: could not build an index, continuing without it: " ++ show e ++ "\n  " ++ T.unpack q
  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS block_data_ref_number_idx ON block_data_ref (number);"
  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS block_data_ref_hash_idx ON block_data_ref (hash);"
  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS block_data_ref_parent_hash_idx ON block_data_ref (parent_hash);"
  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS block_data_ref_coinbase_idx ON block_data_ref (coinbase);"

  -- The API rebuilds a block header from these tables, one lookup by block each.
  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS block_validator_ref_block_data_ref_id_idx ON block_validator_ref (block_data_ref_id);"
  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS validator_delta_ref_block_data_ref_id_idx ON validator_delta_ref (block_data_ref_id);"
  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS proposal_signature_ref_block_data_ref_id_idx ON proposal_signature_ref (block_data_ref_id);"
  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS commitment_signature_ref_block_data_ref_id_idx ON commitment_signature_ref (block_data_ref_id);"
  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS block_stake_ref_block_data_ref_id_idx ON block_stake_ref (block_data_ref_id);"

  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS address_state_ref_address_idx ON address_state_ref (address);"

  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS raw_transaction_from_address_idx ON raw_transaction (from_address);"
  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS raw_transaction_to_address_idx ON raw_transaction (to_address);"
  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS raw_transaction_block_number_idx ON raw_transaction (block_number);"
  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS raw_transaction_tx_hash_idx ON raw_transaction (tx_hash);"

  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS storage_key_idx ON storage (key);"
  -- The FK column has no index of its own, so reading one contract's rows
  -- (vm-query's whole-contract prefetch, strato-api's /storage?address=)
  -- was a scan of the whole table: 26 ms at 2M rows locally, growing with
  -- the mirror. (address_state_ref_id, key) serves both that and the
  -- single-slot lookup.
  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS storage_address_state_ref_id_key_idx ON storage (address_state_ref_id, key);"

  exec "CREATE INDEX CONCURRENTLY IF NOT EXISTS transaction_result_transaction_hash_idx ON transaction_result (transaction_hash);"
  -- One result per (block, transaction): slipstream inserts with ON CONFLICT
  -- DO NOTHING against this, which is what makes a replayed batch, or two
  -- writers overlapping at a lease handoff, unable to duplicate a row. A
  -- database that already holds duplicates (written before this index
  -- existed) cannot build it; that is logged rather than failing startup,
  -- the inserts then rely on their pre-read alone, and the duplicates must
  -- be removed by hand (and the invalid index dropped) for it to build.
  execTolerant "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transaction_result_block_hash_transaction_hash_idx ON transaction_result (block_hash, transaction_hash);"

-- todo newtype me
type Difficulty = Integer

type MapPair = (BS.ByteString, BS.ByteString)

type TextPair = (Text, Text)

instance NFData TXOrigin

instance NFData RawTransaction

instance NFData LogDB

instance NFData EventDB

instance BIN.Binary LogDB

instance BIN.Binary EventDB

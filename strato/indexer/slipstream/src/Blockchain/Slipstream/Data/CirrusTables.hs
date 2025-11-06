{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
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

module Blockchain.Slipstream.Data.CirrusTables where

import Blockchain.Data.PersistTypes ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Control.Monad.Trans.Class (lift)
import qualified Data.Aeson as JSON
import qualified Data.ByteString as BS
import Data.Text (Text)
import Database.Esqueleto.PostgreSQL.JSON
import Database.Persist.Quasi
import Database.Persist.Sql
import Database.Persist.TH

--import Control.Monad.IO.Class
--import qualified Data.Aeson as JSON
--import Data.Text (Text)
--import qualified Database.Esqueleto.Experimental as E
--import Database.Persist hiding ((==.), (=.), (||.), update)
--import Database.Persist.Postgresql hiding ((==.), (=.), (||.), update)
--import           Control.Monad.Logger (runNoLoggingT)


share
  [mkPersist sqlSettings, mkMigrate "migrateAuto"] -- annoying: postgres doesn't like tables called user
  $(persistFileWith lowerCaseSettings "src/Blockchain/Slipstream/Data/CirrusTables.txt")

migrateAll :: Migration
migrateAll = do
  let exec = lift . lift . flip rawExecute []
  exec "ALTER TABLE IF EXISTS block_data_ref DROP COLUMN IF EXISTS block_id;"
  exec "ALTER TABLE IF EXISTS block_transaction DROP COLUMN IF EXISTS block_id;"
  exec "ALTER TABLE IF EXISTS block_data ALTER COLUMN extra_data TYPE bytea USING extra_data::bytea;"
  exec "ALTER TABLE IF EXISTS block_data_ref ALTER COLUMN extra_data TYPE bytea USING extra_data::bytea;"
  exec "ALTER TABLE IF EXISTS address_state_ref DROP COLUMN IF EXISTS source;"
  exec "ALTER TABLE IF EXISTS raw_transaction ALTER COLUMN chain_id SET DEFAULT 0;"
  exec "ALTER TABLE IF EXISTS raw_transaction ALTER COLUMN chain_id SET NOT NULL;"
  exec "ALTER TABLE IF EXISTS chain_info_ref ADD COLUMN IF NOT EXISTS parent_chain varchar;"
  exec "ALTER TABLE IF EXISTS chain_info_ref ADD COLUMN IF NOT EXISTS creation_block varchar;"
  exec "ALTER TABLE IF EXISTS chain_info_ref ADD COLUMN IF NOT EXISTS chain_nonce varchar;"
  exec "ALTER TABLE IF EXISTS storage ADD COLUMN IF NOT EXISTS kind varchar;"
  exec "ALTER TABLE IF EXISTS storage ALTER COLUMN key TYPE varchar;"
  exec "ALTER TABLE IF EXISTS storage ALTER COLUMN value TYPE varchar;"
  exec "ALTER TABLE IF EXISTS transaction_result ALTER COLUMN response TYPE bytea USING response::bytea;"
  migrateAuto

indexAll :: Migration
indexAll = do
  let exec = lift . lift . flip rawExecute []
  exec "CREATE INDEX CONCURRENTLY ON block_data_ref (number);"
  exec "CREATE INDEX CONCURRENTLY ON block_data_ref (hash);"
  exec "CREATE INDEX CONCURRENTLY ON block_data_ref (parent_hash);"
  exec "CREATE INDEX CONCURRENTLY ON block_data_ref (coinbase);"

  exec "CREATE INDEX CONCURRENTLY ON address_state_ref (address);"

  exec "CREATE INDEX CONCURRENTLY ON raw_transaction (from_address);"
  exec "CREATE INDEX CONCURRENTLY ON raw_transaction (to_address);"
  exec "CREATE INDEX CONCURRENTLY ON raw_transaction (block_number);"
  exec "CREATE INDEX CONCURRENTLY ON raw_transaction (tx_hash);"

  exec "CREATE INDEX CONCURRENTLY ON storage (key);"

  exec "CREATE INDEX CONCURRENTLY ON transaction_result (transaction_hash);"

-- todo newtype me
type Difficulty = Integer

type MapPair = (BS.ByteString, BS.ByteString)

type TextPair = (Text, Text)


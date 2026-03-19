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
import Data.Time
import Data.Word
import Database.Persist.Quasi
import Database.Persist.Sql
import Database.Persist.TH
import GHC.Generics
import SolidVM.Model.Storable

share
  [mkPersist sqlSettings, mkMigrate "migrateAuto"] -- annoying: postgres doesn't like tables called user
  $(persistFileWith lowerCaseSettings "src/Blockchain/Data/DataDefs.txt")

migrateAll :: Migration
migrateAll = migrateAuto

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

instance NFData TXOrigin

instance NFData RawTransaction

instance NFData LogDB

instance NFData EventDB

instance BIN.Binary LogDB

instance BIN.Binary EventDB

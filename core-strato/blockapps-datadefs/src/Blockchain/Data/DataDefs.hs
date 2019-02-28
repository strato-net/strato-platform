{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE EmptyDataDecls             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE ForeignFunctionInterface   #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}
{-# OPTIONS_GHC -fno-warn-orphans       #-}

module Blockchain.Data.DataDefs where

import           Control.DeepSeq
import           Control.Lens.TH                         (makeLensesFor)
import           Control.Monad.Trans.Class (lift)

import           Database.Persist
import           Database.Persist.Quasi
import           Database.Persist.Sql
import           Database.Persist.TH

import qualified Data.Binary                             as BIN
import qualified Data.ByteString                         as BS
import           Data.Text                               (Text)
import           Data.Time
import           Data.Time.Clock.POSIX
import           Data.Word
import           GHC.Generics

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.Model.StateRoot
import           Blockchain.SolidVM.Model

import           Blockchain.Data.PersistTypes            ()
import           Blockchain.Data.TransactionResultStatus
import           Blockchain.Data.TXOrigin
import           Blockchain.MiscJSON                     ()


entityDefs :: [EntityDef]
entityDefs = $(persistFileWith lowerCaseSettings "src/Blockchain/Data/DataDefs.txt")

share [mkPersist sqlSettings, mkMigrate "migrateAuto"]  -- annoying: postgres doesn't like tables called user
    $(persistFileWith lowerCaseSettings "src/Blockchain/Data/DataDefs.txt")

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
  migrateAuto

-- todo newtype me
type Difficulty = Integer

type MapPair = (Word256, Word256)
type TextPair = (Text, Text)

makeLensesFor [("blockDataExtraData", "extraDataLens"), ("blockDataMixHash", "mixHashlens")] ''BlockData

instance BIN.Binary UTCTime where
  put = BIN.put . (round :: POSIXTime -> Integer) . utcTimeToPOSIXSeconds
  get = (posixSecondsToUTCTime . fromInteger) <$> BIN.get

instance BIN.Binary BlockData where

instance NFData BlockData
instance NFData TXOrigin
instance NFData RawTransaction
instance NFData TransactionResult
instance NFData LogDB

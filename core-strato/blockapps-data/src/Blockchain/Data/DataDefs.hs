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
import           Control.Monad.Trans.Class (lift)

import           Database.Persist
import           Database.Persist.Quasi
import           Database.Persist.Sql
import           Database.Persist.TH

import           Data.Time
import           Data.Time.Clock.POSIX

import           Blockchain.Data.Address
import           Blockchain.Data.MiningStatus
import           Blockchain.Data.PersistTypes            ()
import           Blockchain.Data.TransactionResultStatus
import           Blockchain.Data.TXOrigin
import           Blockchain.Database.MerklePatricia
import           Blockchain.MiscJSON                     ()

import qualified Data.Binary                             as BIN
import qualified Data.ByteString                         as BS

import           Blockchain.ExtWord
import           Blockchain.SHA
import           Data.Word

import           Control.Lens.TH                         (makeLensesFor)
import           GHC.Generics

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
  migrateAuto

-- todo newtype me
type Difficulty = Integer

type MapPair = (Word256, Word256)

makeLensesFor [("blockDataExtraData", "extraDataLens"), ("blockDataMixHash", "mixHashlens")] ''BlockData

instance BIN.Binary UTCTime where
  put = BIN.put . (round :: POSIXTime -> Integer) . utcTimeToPOSIXSeconds
  get = (posixSecondsToUTCTime . fromInteger) <$> BIN.get

instance BIN.Binary BlockData where

instance NFData BlockData
instance NFData SHA
instance NFData TXOrigin
instance NFData RawTransaction

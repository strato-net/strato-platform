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

module Blockchain.Data.DataDefs where

import           Database.Persist
import           Database.Persist.Quasi
import           Database.Persist.TH

import           Data.Time

import           Blockchain.Data.Address
import           Blockchain.Data.PersistTypes       ()
import           Blockchain.Data.TransactionDef
import           Blockchain.Data.TXOrigin
import           Blockchain.Data.TransactionResultStatus
import           Blockchain.Database.MerklePatricia
import           Blockchain.MiscJSON                ()

import qualified Data.ByteString                    as BS

import           Blockchain.ExtWord
import           Blockchain.SHA
import           Data.Word

import           Data.Aeson
import           GHC.Generics


entityDefs :: [EntityDef]
entityDefs = $(persistFileWith lowerCaseSettings "src/Blockchain/Data/DataDefs.txt")

share [mkPersist sqlSettings, mkMigrate "migrateAll"]  -- annoying: postgres doesn't like tables called user
    $(persistFileWith lowerCaseSettings "src/Blockchain/Data/DataDefs.txt")

instance ToJSON AddressState

-- todo newtype me
type Difficulty = Integer

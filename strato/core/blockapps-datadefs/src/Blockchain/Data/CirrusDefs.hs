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

module Blockchain.Data.CirrusDefs where

-- import           Database.Persist.Sql

-- import           Data.Text

import Blockchain.Data.PersistTypes ()
import Blockchain.MiscJSON ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Data.Time
import Database.Persist.TH
import GHC.Generics

--         Table "public.Certificate"
--        Column       |  Type   | Modifiers
-- --------------------+---------+-----------
--  record_id          | text    | not null
--  address            | text    |
--  chainId            | text    |
--  block_hash         | text    |
--  block_timestamp    | text    |
--  block_number       | text    |
--  transaction_hash   | text    |
--  transaction_sender | text    |
--  certificateString  | text    |
--  commonName         | text    |
--  country            | text    |
--  group              | text    |
--  isValid            | boolean |
--  organization       | text    |
--  organizationalUnit | text    |
--  owner              | text    |
--  parent             | text    |
--  publicKey          | text    |
--  userAddress        | text    |
-- Indexes:
--     "Certificate_pkey" PRIMARY KEY, btree (record_id)

share
  [mkPersist sqlSettings, mkMigrate "migrateAuto"]
  [persistUpperCase|
    Certificate sql="Certificate"
        recordId Address sql="record_id"
        address Address
        chainId Word256 Maybe
        blockHash Keccak256 sql="block_hash"
        blockTimestamp UTCTime sql="block_timestamp"
        blockNumber Integer sqltype=numeric(1000,0) sql="block_number"
        transactionHash Keccak256 sql="transaction_hash"
        transactionSender Address sql="transaction_sender"
        certificateString String
        commonName String
        country String
        group String
        isValid Bool
        organization String
        organizationalUnit String
        owner Address
        parent Address
        publicKey String
        userAddress Address
        Primary recordId
        deriving Eq Generic Show
|]

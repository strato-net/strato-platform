{-# LANGUAGE DataKinds                  #-}
{-# LANGUAGE DeriveDataTypeable         #-}
{-# LANGUAGE DeriveGeneric              #-}
{-# LANGUAGE NoDeriveAnyClass           #-}
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


{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE StandaloneDeriving #-}
{-# LANGUAGE UndecidableInstances #-}
  

module Blockchain.Data.DataDefs where

import           Control.DeepSeq
import           Control.Lens
import           Control.Monad.Trans.Class (lift)

import           Database.Persist.Quasi
import           Database.Persist.Sql
import           Database.Persist.TH

import qualified Data.Binary                             as BIN
import qualified Data.ByteString                         as BS
import qualified Data.ByteString.Base16                  as B16
import qualified Data.ByteString.Char8                   as BC
import qualified Data.ByteString.Short                   as BSS
import           Data.Data
import           Data.Swagger                            hiding (Format, format)
import           Data.Text                               (Text)
import           Data.Time
import           Data.Time.Clock.POSIX
import           Data.Word
import           GHC.Generics
import           Numeric
import           Text.Format
import           Text.PrettyPrint.ANSI.Leijen            hiding ((<$>))

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.StateRoot
import           Blockchain.SolidVM.Model
import           Blockchain.Strato.Model.Account

import           Blockchain.Data.PersistTypes            ()
import           Blockchain.Data.RLP
import           Blockchain.Data.TransactionResultStatus
import           Blockchain.Data.TXOrigin
import           Blockchain.MiscJSON                     ()

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
  exec "ALTER TABLE IF EXISTS transaction_result ALTER COLUMN response TYPE bytea USING response::bytea;"
  migrateAuto

indexAll :: Migration
indexAll = do
  let exec = lift . lift . flip rawExecute []
  exec "CREATE INDEX CONCURRENTLY ON block_data_ref (number);"
  exec "CREATE INDEX CONCURRENTLY ON block_data_ref (hash);"
  exec "CREATE INDEX CONCURRENTLY ON block_data_ref (parent_hash);"
  exec "CREATE INDEX CONCURRENTLY ON block_data_ref (coinbase);"
  exec "CREATE INDEX CONCURRENTLY ON block_data_ref (total_difficulty);"

  exec "CREATE INDEX CONCURRENTLY ON address_state_ref (address);"

  exec "CREATE INDEX CONCURRENTLY ON raw_transaction (from_address);"
  exec "CREATE INDEX CONCURRENTLY ON raw_transaction (to_address);"
  exec "CREATE INDEX CONCURRENTLY ON raw_transaction (block_number);"
  exec "CREATE INDEX CONCURRENTLY ON raw_transaction (tx_hash);"

  exec "CREATE INDEX CONCURRENTLY ON storage (key);"

  exec "CREATE INDEX CONCURRENTLY ON transaction_result (transaction_hash);"

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
instance NFData LogDB
instance NFData EventDB




instance ToSchema LogDB where
  declareNamedSchema _ = return $
    NamedSchema (Just "LogDB") mempty

instance Pretty BS.ByteString where
  pretty = blue . text . BC.unpack . B16.encode

instance RLPSerializable BlockData where
  rlpDecode (RLPArray [v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15]) =
    BlockData {
      blockDataParentHash = rlpDecode v1,
      blockDataUnclesHash = rlpDecode v2,
      blockDataCoinbase = rlpDecode v3,
      blockDataStateRoot = rlpDecode v4,
      blockDataTransactionsRoot = rlpDecode v5,
      blockDataReceiptsRoot = rlpDecode v6,
      blockDataLogBloom = rlpDecode v7,
      blockDataDifficulty = rlpDecode v8,
      blockDataNumber = rlpDecode v9,
      blockDataGasLimit = rlpDecode v10,
      blockDataGasUsed = rlpDecode v11,
      blockDataTimestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode v12,
      blockDataExtraData = rlpDecode v13,
      blockDataMixHash = rlpDecode v14,
      blockDataNonce = bytesToWord64 $ BS.unpack $ rlpDecode v15
      }
  rlpDecode (RLPArray arr) = error ("Error in rlpDecode for Block: wrong number of items, expected 15, got " ++ show (length arr) ++ ", arr = " ++ show (pretty arr))
  rlpDecode x = error ("rlp2BlockData called on non block object: " ++ show x)


  rlpEncode bd =
    RLPArray [
      rlpEncode $ blockDataParentHash bd,
      rlpEncode $ blockDataUnclesHash bd,
      rlpEncode $ blockDataCoinbase bd,
      rlpEncode $ blockDataStateRoot bd,
      rlpEncode $ blockDataTransactionsRoot bd,
      rlpEncode $ blockDataReceiptsRoot bd,
      rlpEncode $ blockDataLogBloom bd,
      rlpEncode $ blockDataDifficulty bd,
      rlpEncode $ blockDataNumber bd,
      rlpEncode $ blockDataGasLimit bd,
      rlpEncode $ blockDataGasUsed bd,
      rlpEncode (round $ utcTimeToPOSIXSeconds $ blockDataTimestamp bd::Integer),
      rlpEncode $ blockDataExtraData bd,
      rlpEncode $ blockDataMixHash bd,
      rlpEncode $ BS.pack $ word64ToBytes $ blockDataNonce bd
      ]


instance Format BlockData where
  format b =
    "parentHash: " ++ format (blockDataParentHash b) ++ "\n" ++
    "unclesHash: " ++ format (blockDataUnclesHash b) ++
    (if blockDataUnclesHash b == hash (BS.pack [0xc0]) then " (the empty array)\n" else "\n") ++
    "coinbase: " ++ show (pretty $ blockDataCoinbase b) ++ "\n" ++
    "stateRoot: " ++ format (blockDataStateRoot b) ++ "\n" ++
    "transactionsRoot: " ++ format (blockDataTransactionsRoot b) ++ "\n" ++
    "receiptsRoot: " ++ format (blockDataReceiptsRoot b) ++ "\n" ++
    "difficulty: " ++ show (blockDataDifficulty b) ++ "\n" ++
    "gasLimit: " ++ show (blockDataGasLimit b) ++ "\n" ++
    "gasUsed: " ++ show (blockDataGasUsed b) ++ "\n" ++
    "timestamp: " ++ show (blockDataTimestamp b) ++ "\n" ++
    "extraData: " ++ show (pretty $ blockDataExtraData b) ++ "\n" ++
    "nonce: " ++ showHex (blockDataNonce b) "" ++ "\n"

instance BlockHeaderLike BlockData where
    blockHeaderBlockNumber      = blockDataNumber
    blockHeaderParentHash       = blockDataParentHash
    blockHeaderOmmersHash       = blockDataUnclesHash
    blockHeaderBeneficiary      = blockDataCoinbase
    blockHeaderStateRoot        = unboxStateRoot . blockDataStateRoot
    blockHeaderTransactionsRoot = unboxStateRoot . blockDataTransactionsRoot
    blockHeaderReceiptsRoot     = unboxStateRoot . blockDataReceiptsRoot
    blockHeaderLogsBloom        = blockDataLogBloom
    blockHeaderGasLimit         = blockDataGasLimit
    blockHeaderGasUsed          = blockDataGasUsed
    blockHeaderDifficulty       = blockDataDifficulty
    blockHeaderNonce            = blockDataNonce
    blockHeaderExtraData        = blockDataExtraData
    blockHeaderTimestamp        = blockDataTimestamp
    blockHeaderMixHash          = blockDataMixHash

    blockHeaderModifyExtra      = over extraDataLens

    morphBlockHeader h2 =
        BlockData { blockDataNumber           = blockHeaderBlockNumber h2
                  , blockDataParentHash       = blockHeaderParentHash h2
                  , blockDataUnclesHash       = blockHeaderOmmersHash h2
                  , blockDataCoinbase         = blockHeaderBeneficiary h2
                  , blockDataStateRoot        = StateRoot $ blockHeaderStateRoot h2
                  , blockDataTransactionsRoot = StateRoot $ blockHeaderTransactionsRoot h2
                  , blockDataReceiptsRoot     = StateRoot $ blockHeaderReceiptsRoot h2
                  , blockDataLogBloom         = blockHeaderLogsBloom h2
                  , blockDataGasLimit         = blockHeaderGasLimit h2
                  , blockDataGasUsed          = blockHeaderGasUsed h2
                  , blockDataDifficulty       = blockHeaderDifficulty h2
                  , blockDataNonce            = blockHeaderNonce h2
                  , blockDataExtraData        = blockHeaderExtraData h2
                  , blockDataTimestamp        = blockHeaderTimestamp h2
                  , blockDataMixHash          = blockHeaderMixHash h2
                  }

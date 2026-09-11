{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

-- | A sample SolidVM contract in the shape strato-indexer's state mirror
-- writes, so the spike can run without a live core: one account row with
-- its code, a block row to be "latest", and storage rows for a public
-- scalar and a mapping with many keys (each key is one SQL round trip on a
-- cold read, which is what the spike measures).
module Blockchain.VmQuery.Seed
  ( sampleAddress,
    sampleSource,
    sampleMappingSize,
    seedSample,
    migrateMirror,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Strato.Model.Address (Address (..))
import Blockchain.Strato.Model.Keccak256 (hash, unsafeCreateKeccak256FromWord256)
import qualified Blockchain.Strato.Model.StateRoot as SR
import Control.Monad (forM_, void)
import Control.Monad.IO.Class (liftIO)
import qualified Data.ByteString.Char8 as BC
import Data.Text.Encoding (decodeUtf8)
import Data.Time.Clock (getCurrentTime)
import Database.Persist ((==.))
import qualified Database.Persist as P
import Database.Persist.Postgresql (runMigration)
import SolidVM.Model.Storable (BasicValue (..), StoragePath (..), StoragePathPiece (..))

sampleAddress :: Address
sampleAddress = Address 0xc0ffee0000000000000000000000000000000001

sampleMappingSize :: Int
sampleMappingSize = 256

-- | Plain SolidVM: a scalar, a mapping, and a loop that reads @n@ mapping
-- keys, so one call can touch as many storage slots as the spike asks for.
sampleSource :: BC.ByteString
sampleSource =
  BC.unlines
    [ "contract Counter {",
      "  uint public x;",
      "  mapping(uint => uint) public m;",
      "  function get() public view returns (uint) { return x; }",
      "  function at(uint i) public view returns (uint) { return m[i]; }",
      "  function total(uint n) public view returns (uint) {",
      "    uint s = 0;",
      "    for (uint i = 0; i < n; i++) { s += m[i]; }",
      "    return s;",
      "  }",
      "}"
    ]

migrateMirror :: HasSQLDB m => m ()
migrateMirror = sqlQueryWriter $ runMigration migrateAll

-- | Idempotent: rows already present are left alone.
seedSample :: HasSQLDB m => m ()
seedSample = sqlQueryWriter $ do
  let codeHash' = hash sampleSource
      blockHash = unsafeCreateKeccak256FromWord256 0xb10c
  existingBlock <- P.selectFirst [BlockDataRefHash ==. blockHash] []
  case existingBlock of
    Just _ -> pure ()
    Nothing -> do
      ts <- liftIO getCurrentTime
      void . P.insert $
        BlockDataRef
          { blockDataRefParentHash = unsafeCreateKeccak256FromWord256 0,
            blockDataRefUnclesHash = unsafeCreateKeccak256FromWord256 0,
            blockDataRefCoinbase = Address 0,
            blockDataRefStateRoot = SR.emptyTriePtr,
            blockDataRefTransactionsRoot = SR.emptyTriePtr,
            blockDataRefReceiptsRoot = SR.emptyTriePtr,
            blockDataRefLogBloom = BC.replicate 256 '\0',
            blockDataRefDifficulty = 0,
            blockDataRefNumber = 1,
            blockDataRefGasLimit = 100000000,
            blockDataRefGasUsed = 0,
            blockDataRefTimestamp = ts,
            blockDataRefExtraData = "",
            blockDataRefNonce = 0,
            blockDataRefMixHash = unsafeCreateKeccak256FromWord256 0,
            blockDataRefHash = blockHash,
            blockDataRefPowVerified = True,
            blockDataRefIsConfirmed = True,
            blockDataRefVersion = 3,
            blockDataRefProposalRound = Nothing
          }
  _ <- P.insertBy $ CodeRef codeHash' (decodeUtf8 sampleSource)
  existing <- P.getBy (UniqueAddress sampleAddress)
  sid <- case existing of
    Just (P.Entity k _) -> pure k
    Nothing -> P.insert $ AddressStateRef sampleAddress 0 0 SR.emptyTriePtr (Just codeHash') (Just "Counter") 1
  rows <- P.selectFirst [StorageAddressStateRefId ==. sid] []
  case rows of
    Just _ -> pure ()
    Nothing -> do
      void . P.insert $ Storage sid (StoragePath [Field "x"]) (BInteger 42)
      forM_ [0 .. sampleMappingSize - 1] $ \i ->
        void . P.insert $ Storage sid (StoragePath [Field "m", Index (BC.pack (show i))]) (BInteger (fromIntegral i))

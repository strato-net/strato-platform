{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module Main where

import Blockchain.Data.RLP
import Blockchain.Database.MerklePatricia
import Blockchain.Database.MerklePatricia.Internal
import Blockchain.Database.MerklePatricia.MPDB
import Blockchain.Util
import Control.Monad.State
import Control.Monad.Trans.Resource
import qualified Data.Map.Strict as M
import qualified Data.NibbleString as N
import qualified Database.LevelDB as LD
import Test.HUnit

bigTest :: [(Key, String)]
bigTest =
  [ ("00000000000000000000000000000000ffffffffffffffff0000000000000000", "90467269656e647320262046616d696c79"),
    ("00000000000000000000000000000000ffffffffffffffff0000000000000001", "8772656631323334"),
    ("00000000000000000000000000000000ffffffffffffffff0000000000000002", "04"),
    ("00000000000000000000000000000000ffffffffffffffff0000000000000003", "84548123a8"),
    ("0000000000000000000000000000000000000000000000000000000000000000", "974c696162696c69746965733a496e697469616c4c6f616e"),
    ("0000000000000000000000000000000000000000000000000000000000000001", "a0fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe7960"),
    ("0000000000000000000000000000000000000000000000000000000000000002", "83555344"),
    ("0000000000000000000000000000000000000000000000010000000000000000", "8f4173736574733a436865636b696e67"),
    ("0000000000000000000000000000000000000000000000010000000000000001", "830186a0"),
    ("0000000000000000000000000000000000000000000000010000000000000002", "83555344"),
    ("00000000000000000000000000000002ffffffffffffffff0000000000000003", "84548123a8")
  ]

testGetPut :: Test
testGetPut = TestCase $ do
  res <- runMP $ do
    db <- putSingleKV key val
    getSingleKV db key

  assertEqual "get . put = id" res [(key, val)]

testGetPutRepeated :: Test
testGetPutRepeated = TestCase $ do
  res <- runMP $ do
    db <- putSingleKV key val
    db2 <- unsafePutKeyValMem db key2 val2
    getSingleKV db2 key2

  assertEqual "get . put . put = id" res [(key2, val2)]

testGetPutRepeatedII :: Test
testGetPutRepeatedII = TestCase $ do
  res <- runMP $ do
    db <- addAllKVs blank bigTest
    getSingleKV db "00000000000000000000000000000002ffffffffffffffff0000000000000003"

  assertEqual "get . putn = id" res [("00000000000000000000000000000002ffffffffffffffff0000000000000003", rlpEncode $ rlpSerialize $ rlpEncode ("84548123a8" :: String))]

testSingleInsert :: Test
testSingleInsert = TestCase $ do
  sr <- runResourceT $ do
    db <- LD.open "/tmp/testDB" LD.defaultOptions {LD.createIfMissing = True}

    let ldb' = MPDB {ldb = db, stateRoot = emptyTriePtr}

    initializeBlank ldb'

    addAllKVs ldb' [head bigTest]

  sr2 <- runMP $ addAllKVs emptyTriePtr [head bigTest]

  assertEqual "disk - mem single insert" (stateRoot sr) sr2

testMultipleInserts :: Test
testMultipleInserts = TestCase $ do
  sr <- runResourceT $ do
    db <- LD.open "/tmp/testDB2" LD.defaultOptions {LD.createIfMissing = True}

    let ldb' = MPDB {ldb = db, stateRoot = emptyTriePtr}

    initializeBlank ldb'

    addAllKVs ldb' bigTest

  sr2 <- runMP $ addAllKVs emptyTriePtr bigTest

  assertEqual "disk - mem multiple insert" (stateRoot sr) sr2

key :: N.NibbleString
key = (byteString2NibbleString "anyString")

val :: RLPObject
val = (RLPString "anotherString")

key2 :: N.NibbleString
key2 = (byteString2NibbleString "otherString")

val2 :: RLPObject
val2 = (RLPString "thatString2")

putSingleKV :: (StateRoot `Alters` NodeData) m => Key -> Val -> m StateRoot
putSingleKV = unsafePutKeyVal emptyTriePtr

getSingleKV :: (StateRoot `Alters` NodeData) m => StateRoot -> Key -> m [(Key, Val)]
getSingleKV = unsafeGetKeyVals

main :: IO ()
main = do
  _ <-
    runTestTT $
      TestList
        [ TestLabel " get . put = id" testGetPut,
          TestLabel " get . put . put = id" testGetPutRepeated,
          TestLabel " get . putn = id" testGetPutRepeatedII,
          TestLabel " single insert" testSingleInsert,
          TestLabel " multiple insert" testMultipleInserts
        ]

  return ()

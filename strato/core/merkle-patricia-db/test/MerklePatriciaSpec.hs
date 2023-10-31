{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Main where

import Blockchain.Data.RLP
import Blockchain.Database.MerklePatricia
import Blockchain.Database.MerklePatricia.Internal
import Blockchain.Strato.Model.Util
import Control.Monad.Change.Alter
import Control.Monad.Trans.Reader
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import qualified Data.NibbleString as N
import qualified Database.LevelDB as LD
import Test.HUnit
import Test.Hspec
import Test.Hspec.Contrib.HUnit (fromHUnitTest)

bigTest :: [(B.ByteString, String)]
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
    db2 <- unsafePutKeyVal db key2 val2

    getSingleKV db2 key2

  assertEqual "get . put . put = id" res [(key2, val2)]

testGetPutRepeatedII :: Test
testGetPutRepeatedII = TestCase $ do
  res <- runMP $ do
    db <- addAllKVs emptyTriePtr bigTest
    getSingleKV db keyFromRawBS

  assertEqual "get . putn = id" res [(keyFromRawBS, rlpEncode $ rlpSerialize $ rlpEncode ("84548123a8" :: String))]

testSingleInsert :: Test
testSingleInsert = TestCase $ do
  sr <- runResourceT $ do
    db <- LD.open "/tmp/testDB" LD.defaultOptions {LD.createIfMissing = True}
    flip runReaderT db $ do
      initializeBlank
      addAllKVs emptyTriePtr [head bigTest]

  sr2 <- runMP $ addAllKVs emptyTriePtr [head bigTest]

  assertEqual "disk - mem single insert" sr sr2

testMultipleInserts :: Test
testMultipleInserts = TestCase $ do
  sr <- runResourceT $ do
    db <- LD.open "/tmp/testDB2" LD.defaultOptions {LD.createIfMissing = True}
    flip runReaderT db $ do
      initializeBlank
      addAllKVs emptyTriePtr bigTest

  sr2 <- runMP $ addAllKVs emptyTriePtr bigTest

  assertEqual "disk - mem multiple insert" sr sr2

key :: N.NibbleString
key = (byteString2NibbleString "anyString")

val :: RLPObject
val = (RLPString "anotherString")

key2 :: N.NibbleString
key2 = (byteString2NibbleString "otherString")

val2 :: RLPObject
val2 = (RLPString "thatString2")

keyFromRawBS :: N.NibbleString
keyFromRawBS = byteString2NibbleString $ rlpSerialize $ rlpEncode ("00000000000000000000000000000002ffffffffffffffff0000000000000003" :: B.ByteString)

putSingleKV :: (StateRoot `Alters` NodeData) m => Key -> Val -> m StateRoot
putSingleKV = unsafePutKeyVal emptyTriePtr

getSingleKV :: (StateRoot `Alters` NodeData) m => StateRoot -> Key -> m [(Key, Val)]
getSingleKV = unsafeGetKeyVals

spec :: Spec
spec = do
  describe "the old merkle-patricia test suite" $ do
    fromHUnitTest $
      TestList
        [ TestLabel " get . put = id" testGetPut,
          TestLabel " get . put . put = id" testGetPutRepeated,
          TestLabel " get . putn = id" testGetPutRepeatedII,
          TestLabel " single insert" testSingleInsert,
          TestLabel " multiple insert" testMultipleInserts
        ]

main :: IO ()
main = hspec spec

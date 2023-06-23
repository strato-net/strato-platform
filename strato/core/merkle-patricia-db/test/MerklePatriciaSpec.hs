{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TypeOperators         #-}
{-# LANGUAGE TupleSections         #-}
{-# OPTIONS_GHC -fno-warn-orphans  #-}

module Main where

import           Blockchain.Data.RLP
import           Blockchain.Database.MerklePatricia
import           Blockchain.Database.MerklePatricia.ForEach
import           Blockchain.Database.MerklePatricia.Internal
import           Blockchain.Database.MerklePatricia.InternalMem
import           Blockchain.Database.MerklePatriciaMem
import           Blockchain.Strato.Model.Util
import           Control.Monad.Change.Alter
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.Resource
import           Data.ByteString.Char8                          (ByteString)
import qualified Data.Bifunctor                                 as BF (first)                                   
import qualified Data.NibbleString                              as N
import qualified Database.LevelDB                               as LD
import           Test.Hspec
import           Test.Hspec.Contrib.HUnit                       (fromHUnitTest)
import           Test.HUnit
import           Test.QuickCheck
import           Test.QuickCheck.Monadic                        (assert, monadicIO, run)

bigTest :: [(Key,String)]
bigTest=
  [
    ("00000000000000000000000000000000ffffffffffffffff0000000000000000", "90467269656e647320262046616d696c79"),
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

addAllKVs :: (RLPSerializable obj, (StateRoot `Alters` NodeData) m)
          => StateRoot -> [(N.NibbleString, obj)] -> m StateRoot
addAllKVs x [] = return x
addAllKVs sr (x:rest) = do
  sr' <- unsafePutKeyVal sr (fst x) (rlpEncode $ rlpSerialize $ rlpEncode $ snd x)
  addAllKVs sr' rest

addAllKVsMem :: RLPSerializable obj => Monad m => MPMem -> [(N.NibbleString, obj)] -> m MPMem
addAllKVsMem x [] = return x
addAllKVsMem mpdb (x:rest) = do
  mpdb' <- unsafePutKeyValMem mpdb (fst x) (rlpEncode $ rlpSerialize $ rlpEncode $ snd x)
  addAllKVsMem mpdb' rest

blank :: MPMem
blank = initializeBlankMem {mpStateRoot=emptyTriePtr}

testGetPut :: Test
testGetPut = TestCase $ do
  db <- putSingleKV key val
  res <- getSingleKV db key

  assertEqual "get . put = id" res [(key,val)]

testGetPutRepeated :: Test
testGetPutRepeated = TestCase $ do
  db <- putSingleKV key val
  db2 <- unsafePutKeyValMem db key2 val2

  res <- getSingleKV db2 key2

  assertEqual "get . put . put = id" res [(key2,val2)]

testGetPutRepeatedII :: Test
testGetPutRepeatedII = TestCase $ do
  db <- addAllKVsMem blank bigTest

  res <- getSingleKV db "00000000000000000000000000000002ffffffffffffffff0000000000000003"

  assertEqual "get . putn = id" res [("00000000000000000000000000000002ffffffffffffffff0000000000000003",rlpEncode $ rlpSerialize $ rlpEncode ("84548123a8" :: String))]

testSingleInsert :: Test
testSingleInsert = TestCase $ do
  sr <- runResourceT $ do
    db <- LD.open "/tmp/testDB" LD.defaultOptions{LD.createIfMissing=True}
    flip runReaderT db $ do
      initializeBlank
      addAllKVs emptyTriePtr [head bigTest]

  sr2 <- addAllKVsMem blank [head bigTest]

  assertEqual "disk - mem single insert" sr (mpStateRoot sr2)

testMultipleInserts :: Test
testMultipleInserts = TestCase $ do
  sr <- runResourceT $ do
    db <- LD.open "/tmp/testDB2" LD.defaultOptions{LD.createIfMissing=True}
    flip runReaderT db $ do
      initializeBlank
      addAllKVs emptyTriePtr bigTest

  sr2 <- addAllKVsMem blank bigTest

  assertEqual "disk - mem multiple insert" sr (mpStateRoot sr2)


key :: N.NibbleString
key = (byteString2NibbleString "anyString")

val :: RLPObject
val = (RLPString "anotherString")

key2 :: N.NibbleString
key2 = (byteString2NibbleString "otherString")

val2 :: RLPObject
val2 = (RLPString "thatString2")

putSingleKV :: (Monad m) => Key->Val->m MPMem
putSingleKV k v= unsafePutKeyValMem blank k v

getSingleKV :: (Monad m) => MPMem -> Key -> m [(Key,Val)]
getSingleKV db key' = unsafeGetKeyValsMem db key'

--To ensure scraping MPT leaves and keys, then
--the recreation of another MPT with those leaves and keys
--will produce the same stateroot
testMPTScrapeCheck :: [[(Key, ByteString)]] -> Property
testMPTScrapeCheck data_set = monadicIO $  do
  case data_set of 
      [] -> Test.QuickCheck.Monadic.assert  True
      _  -> do
                let make_initial_MPT_and_scrape data' = runResourceT $ do
                      db <- LD.open "/tmp/testDB3" LD.defaultOptions{LD.createIfMissing=True}
                      flip runReaderT db $ do 
                          initializeBlank
                          sr' <- addAllKVs emptyTriePtr data'
                          leaf_keys <- fmap (map (BF.first N.EvenNibbleString))   $ getAllLeafKeyVals sr'
                          return (sr', leaf_keys)
                sr_lks <- run $  mapM  (make_initial_MPT_and_scrape) data_set
                let (srs, ls_lks) = unzip sr_lks
                let make_new_MPT lks = runResourceT $ do
                        db <- LD.open "/tmp/testDB4" LD.defaultOptions{LD.createIfMissing=True}
                        flip runReaderT db $ do
                          initializeBlank
                          let properly_formed_lk :: [(N.NibbleString, ByteString)] = map (\(k, v) -> (k,) . rlpDecode . rlpDeserialize . rlpDecode $ v)  lks
                          addAllKVs emptyTriePtr  properly_formed_lk
                sr2s <- run $ mapM  (make_new_MPT) ls_lks
                Test.QuickCheck.Monadic.assert $ srs == sr2s
          

spec :: Spec
spec = do
  describe "the old merkle-patricia test suite" $ do
       fromHUnitTest $ TestList [TestLabel " get . put = id" testGetPut,
                                 TestLabel " get . put . put = id" testGetPutRepeated,
                                 TestLabel " get . putn = id" testGetPutRepeatedII,
                                 TestLabel " single insert" testSingleInsert,
                                 TestLabel " multiple insert" testMultipleInserts]
  describe "the old with a new twist merkle-patricia test suite" $ do
    it "can reproduce the MPT" $ quickCheck testMPTScrapeCheck


main :: IO ()
main = hspec spec

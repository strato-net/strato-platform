{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Main where

import Blockchain.Data.RLP
import Blockchain.Database.MerklePatricia
import Blockchain.Database.MerklePatricia.Internal
import Blockchain.Database.MerklePatricia.NodeData (emptyRef, ptrRef, smallRef)
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
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

bigTestHead :: (B.ByteString, String)
bigTestHead = ("00000000000000000000000000000000ffffffffffffffff0000000000000000", "90467269656e647320262046616d696c79")

bigTest :: [(B.ByteString, String)]
bigTest =
  [ bigTestHead,
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
      addAllKVs emptyTriePtr [bigTestHead]

  sr2 <- runMP $ addAllKVs emptyTriePtr [bigTestHead]

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

testSerializeNodeDataMatchesCanonicalRLP :: Test
testSerializeNodeDataMatchesCanonicalRLP = TestCase $
  mapM_ assertEquivalent representativeNodes
  where
    assertEquivalent node =
      assertEqual
        ("direct node serialization for " ++ take 80 (show node))
        (rlpSerialize $ rlpEncode node)
        (serializeNodeData node)
    hashedChild = StateRoot $ B.replicate 32 0x42
    inlineChild = rlpSerialize $ RLPArray [RLPString "inline"]
    children = smallRef inlineChild : ptrRef hashedChild : replicate 14 emptyRef
    representativeNodes =
      [ EmptyNodeData,
        ShortcutNodeData (N.pack [1, 2, 3]) (Right $ RLPString "value"),
        ShortcutNodeData (N.pack [4, 5]) (Left $ smallRef inlineChild),
        ShortcutNodeData (N.pack [6, 7, 8]) (Left $ ptrRef hashedChild),
        FullNodeData children Nothing,
        FullNodeData children (Just $ RLPString $ B.replicate 80 0xab)
      ]

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

-- ============ getInclusionProof tests ============

-- Mirrors the on-chain MerklePatricia.verifyInclusion logic to verify a
-- (root, key, value, proof) tuple end-to-end inside Haskell. Used to confirm
-- that 'getInclusionProof' produces well-formed proofs without needing a
-- cross-language fixture.
verifyInclusionHaskell ::
  StateRoot ->
  N.NibbleString ->
  B.ByteString ->
  [B.ByteString] ->
  Bool
verifyInclusionHaskell _ _ _ [] = False
verifyInclusionHaskell root keyN expected (firstNode : rest) =
  let rootHash = hashNode firstNode
   in if rootHash /= unboxStateRoot root
        then False
        else walk firstNode keyN (rest, True)
  where
    hashNode bs = keccak256ToByteString (hash bs)

    walk bs k (proofRest, isHashed) =
      let isHashOk = not isHashed || True -- caller already checked
          nd = rlpDecode (rlpDeserialize bs) :: NodeData
       in (case nd of
             EmptyNodeData -> False
             FullNodeData _ (Just v)
               | N.null k -> rlpDecode v == expected
             FullNodeData _ Nothing
               | N.null k -> False
             FullNodeData cs _ ->
               let n = fromIntegral (N.head k)
                   childRef = cs !! n
                   k' = N.tail k
                in stepInto childRef k' proofRest
             ShortcutNodeData s (Right v) ->
               s == k && rlpDecode v == expected
             ShortcutNodeData s (Left ref) ->
               s `N.isPrefixOf` k
                 && stepInto ref (N.drop (N.length s) k) proofRest)
        && isHashOk

    stepInto (Right _expectedSr) k' (next : remaining) =
      hashNode next == unboxStateRoot _expectedSr
        && walk next k' (remaining, True)
    stepInto (Right _) _ [] = False
    stepInto (Left bytes) _ _
      | bytes == B.pack [0x80] = False -- empty ref
    stepInto (Left bytes) k' proofRest =
      let nd = rlpDecode (rlpDeserialize bytes) :: NodeData
       in walkInline nd k' proofRest

    walkInline nd k proofRest = case nd of
      EmptyNodeData -> False
      FullNodeData _ (Just v) | N.null k -> rlpDecode v == expected
      FullNodeData _ Nothing | N.null k -> False
      FullNodeData cs _ ->
        let n = fromIntegral (N.head k)
         in stepInto (cs !! n) (N.tail k) proofRest
      ShortcutNodeData s (Right v) ->
        s == k && rlpDecode v == expected
      ShortcutNodeData s (Left ref) ->
        s `N.isPrefixOf` k
          && stepInto ref (N.drop (N.length s) k) proofRest

-- A test-only newtype that lets us pass a hand-rolled RLPObject through
-- 'addAllKVs' (which requires RLPSerializable on the value type). The
-- production receipts trie uses 'Receipt' from blockapps-data; this test
-- doesn't take that dep so it builds an equivalent shape locally.
newtype TestReceipt = TestReceipt RLPObject

instance RLPSerializable TestReceipt where
  rlpEncode (TestReceipt o) = o
  rlpDecode = TestReceipt

-- A Receipt-shaped value: an RLPArray of 3 elements. Big enough that leaves
-- get hashed (>= 32 bytes encoded).
sampleReceipt :: Integer -> TestReceipt
sampleReceipt nonce = TestReceipt $
  RLPArray
    [ rlpEncode (1 :: Integer), -- status
      rlpEncode (21000 :: Integer), -- gasUsed
      RLPArray
        [ RLPArray
            [ rlpEncode ("aabbccddeeff00112233445566778899aabbccdd" :: B.ByteString),
              rlpEncode ("Withdrawal" :: B.ByteString),
              RLPArray $
                rlpEncode nonce
                  : rlpEncode (1 :: Integer)
                  : replicate 6 (rlpEncode ("00000000000000000000000000000000000000ff" :: B.ByteString))
            ]
        ]
    ]

testGetInclusionProofSingle :: Test
testGetInclusionProofSingle = TestCase $ do
  res <- runMP $ do
    sr <- addAllKVs emptyTriePtr [(0 :: Integer, sampleReceipt 42)]
    let k = byteString2NibbleString $ rlpSerialize $ rlpEncode (0 :: Integer)
    proof <- getInclusionProof sr k
    return (sr, k, proof)
  case res of
    (_, _, Nothing) -> assertFailure "expected proof, got Nothing"
    (sr, k, Just (valueBytes, proofNodes)) -> do
      let expectedBytes = rlpSerialize (rlpEncode (sampleReceipt 42))
      assertEqual "value bytes" expectedBytes valueBytes
      assertBool "proof verifies against root"
        $ verifyInclusionHaskell sr k valueBytes proofNodes

testGetInclusionProofMissingKey :: Test
testGetInclusionProofMissingKey = TestCase $ do
  res <- runMP $ do
    sr <- addAllKVs emptyTriePtr [(0 :: Integer, sampleReceipt 1)]
    let absentKey = byteString2NibbleString $ rlpSerialize $ rlpEncode (5 :: Integer)
    getInclusionProof sr absentKey
  assertEqual "absent key" Nothing res

testGetInclusionProofMultiTx :: Test
testGetInclusionProofMultiTx = TestCase $ do
  let receipts = [(i :: Integer, sampleReceipt i) | i <- [0 .. 4]]
  res <- runMP $ do
    sr <- addAllKVs emptyTriePtr receipts
    fmap (sr,) $
      mapM
        ( \(i, _) -> do
            let k = byteString2NibbleString $ rlpSerialize $ rlpEncode i
            proof <- getInclusionProof sr k
            return (i, k, proof)
        )
        receipts
  let (sr, results) = res
  flip mapM_ results $ \(i, k, mProof) -> case mProof of
    Nothing -> assertFailure $ "expected proof for txIndex=" ++ show i
    Just (valueBytes, proofNodes) -> do
      let expectedBytes = rlpSerialize (rlpEncode (sampleReceipt i))
      assertEqual ("value bytes for txIndex=" ++ show i) expectedBytes valueBytes
      assertBool ("proof verifies for txIndex=" ++ show i)
        $ verifyInclusionHaskell sr k valueBytes proofNodes

testGetInclusionProofTamperedRejected :: Test
testGetInclusionProofTamperedRejected = TestCase $ do
  res <- runMP $ do
    sr <- addAllKVs emptyTriePtr [(0 :: Integer, sampleReceipt 7)]
    let k = byteString2NibbleString $ rlpSerialize $ rlpEncode (0 :: Integer)
    proof <- getInclusionProof sr k
    return (sr, k, proof)
  case res of
    (_, _, Nothing) -> assertFailure "expected proof"
    (sr, k, Just (valueBytes, proofNodes)) -> do
      let tamperedValue = B.append valueBytes (B.pack [0xab])
      assertBool "tampered value rejected"
        $ not (verifyInclusionHaskell sr k tamperedValue proofNodes)

spec :: Spec
spec = do
  describe "the old merkle-patricia test suite" $ do
    fromHUnitTest $
      TestList
        [ TestLabel " get . put = id" testGetPut,
          TestLabel " get . put . put = id" testGetPutRepeated,
          TestLabel " get . putn = id" testGetPutRepeatedII,
          TestLabel " single insert" testSingleInsert,
          TestLabel " multiple insert" testMultipleInserts,
          TestLabel " direct node serialization matches canonical RLP"
            testSerializeNodeDataMatchesCanonicalRLP
        ]
  describe "getInclusionProof" $ do
    fromHUnitTest $
      TestList
        [ TestLabel "single-tx trie: round-trips through verifier"
            testGetInclusionProofSingle,
          TestLabel "missing key returns Nothing"
            testGetInclusionProofMissingKey,
          TestLabel "multi-tx trie: each entry's proof verifies independently"
            testGetInclusionProofMultiTx,
          TestLabel "tampered value rejected by verifier"
            testGetInclusionProofTamperedRejected
        ]

main :: IO ()
main = hspec spec

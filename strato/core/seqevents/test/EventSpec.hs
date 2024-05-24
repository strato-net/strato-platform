{-# OPTIONS -fno-warn-unused-imports #-}

import Blockchain.Data.ArbitraryInstances ()
import Blockchain.Data.BlockHeader
import qualified Blockchain.Data.ChainInfo as CI
import qualified Blockchain.Data.DataDefs as DD
import qualified Blockchain.Data.Transaction as TX
import Blockchain.Sequencer.Event
import Data.Binary
import Test.Hspec
import Test.QuickCheck

main :: IO ()
main = hspec spec

binaryFidelity :: (Eq a, Show a, Binary a) => a -> Expectation
binaryFidelity x = decode (encode x) `shouldBe` x

spec :: Spec
spec = parallel $ do
  describe "Transaction" $ do
    it "should be serializable and deserializable" $
      property $
        \x -> binaryFidelity (x :: TX.Transaction)
  describe "BlockHeader" $ do
    it "should be serializable and deserializable" $
      property $
        \x -> binaryFidelity (x :: BlockHeader)
  describe "AccountInfo" $ do
    it "should be serializable and deserializable" $
      property $
        \x -> binaryFidelity (x :: CI.AccountInfo)
  describe "CodeInfo" $ do
    it "should be serializable and deserializable" $
      property $
        \x -> binaryFidelity (x :: CI.CodeInfo)
  describe "ChainInfo" $ do
    it "should be serializable and deserializable" $
      property $
        \x -> binaryFidelity (x :: CI.ChainInfo)
  describe "IngestTx" $ do
    it "should be serializable and deserializable" $
      property $ do
        \x -> binaryFidelity (x :: IngestTx)
  describe "IngestBlock" $ do
    it "should be serializable and deserializable" $
      property $ do
        \x -> binaryFidelity (x :: IngestBlock)
  describe "SequencedBlock" $ do
    it "should be serializable and deserializable" $
      property $ do
        \x -> binaryFidelity (x :: SequencedBlock)
  describe "OutputTx" $ do
    it "should be serializable and deserializable" $
      property $ do
        \x -> binaryFidelity (x :: OutputTx)
  describe "OutputBlock" $ do
    it "should be serializable and deserializable" $
      property $ do
        \x -> binaryFidelity (x :: OutputBlock)

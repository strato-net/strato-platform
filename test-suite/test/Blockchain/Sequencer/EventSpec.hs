module Blockchain.Sequencer.EventSpec where

import Data.Binary
import Test.Hspec
import Test.QuickCheck

import Blockchain.Sequencer.Event
import Blockchain.Sequencer.ArbitraryInstances()
import Blockchain.Data.ArbitraryInstances()

spec :: Spec
spec = parallel $ do
    describe "IngestTx" $ do
        it "should be serializable and deserializable" $ property $ do
            \x -> (decode . encode) x == (x :: IngestTx)

    describe "IngestBlock" $ do
        it "should be serializable and deserializable" $ property $ do
            \x -> (decode . encode) x == (x :: IngestBlock)

    describe "SequencedBlock" $ do
        it "should be serializable and deserializable" $ property $ do
            \x -> (decode . encode) x == (x :: SequencedBlock)

    describe "OutputTx" $ do
        it "should be serializable and deserializable" $ property $ do
            \x -> (decode . encode) x == (x :: OutputTx)

    describe "OutputBlock" $ do
        it "should be serializable and deserializable" $ property $ do
            \x -> (decode . encode) x == (x :: OutputBlock)

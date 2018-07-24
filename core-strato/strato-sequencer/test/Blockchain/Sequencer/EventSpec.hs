module Blockchain.Sequencer.EventSpec where

import           Data.Binary
import           Test.Hspec
import           Test.QuickCheck

import           Blockchain.Data.ArbitraryInstances      ()
import qualified Blockchain.Data.ChainInfo               as CI
import qualified Blockchain.Data.DataDefs                as DD
import qualified Blockchain.Data.GenesisInfo             as GI
import qualified Blockchain.Data.Transaction             as TX
import           Blockchain.Sequencer.ArbitraryInstances ()
import           Blockchain.Sequencer.Event

main :: IO ()
main = hspec spec

spec :: Spec
spec = parallel $ do
    describe "Transaction" $ do
        it "should be serializable and deserializable" $ property $ do
            \x -> (decode . encode) x == (x :: TX.Transaction)

    describe "BlockData" $ do
        it "should be serializable and deserializable" $ property $ do
            \x -> (decode . encode) x == (x :: DD.BlockData)

    describe "AccountInfo" $ do
        it "should be serializable and deserializable" $ property $ do
            \x -> (decode . encode) x == (x :: GI.AccountInfo)

    describe "CodeInfo" $ do
        it "should be serializable and deserializable" $ property $ do
            \x -> (decode . encode) x == (x :: GI.CodeInfo)

    describe "ChainInfo" $ do
        it "should be serializable and deserializable" $ property $ do
            \x -> (decode . encode) x == (x :: CI.ChainInfo)

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

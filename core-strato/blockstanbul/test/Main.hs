{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}
module Main where

import Test.Hspec
import Test.QuickCheck

import Conduit
import Control.Monad.Trans.State

import Blockchain.Data.ArbitraryInstances()
import Blockchain.Data.BlockDB
import Blockchain.Blockstanbul.EventLoop
import Blockchain.Blockstanbul.Messages

main :: IO ()
main = hspec spec

expectAs :: (MonadIO m, Eq a, Show a) => a -> a -> m ()
expectAs x y = liftIO $ x `shouldBe` y

testContext :: BlockstanbulContext
testContext = BlockstanbulContext
  (RoundId 20 18)
  (const True)

runTest :: StateT BlockstanbulContext IO () -> IO ()
runTest = flip evalStateT testContext

spec :: Spec
spec = do
  describe "A harness? what do you need that for?" $ do
    it "it secures a seat on the horse" $ do
      let v1 = RoundId 200 30
      roundidSequence v1 `shouldBe` 30

  describe "The event loop" $ do
    let sendMessages :: (StateMachineM m) => [BlockstanbulEvent] -> m [BlockstanbulEvent]
        sendMessages wms = runConduit (yieldMany wms .| eventLoop .| sinkList)
    it "does nothing to the messages" $ property $ \auth blk ->
      runTest $ do
        let m1 = Preprepare auth (RoundId 0 0) blk
        let hash = blockHash blk
        m2 <- sendMessages [m1]
        m2 `expectAs` [Prepare auth (RoundId 0 0) hash]
        m3 <- sendMessages m2
        m3 `expectAs` [Commit auth (RoundId 0 0) hash]
        m4 <- sendMessages m3
        m4 `expectAs` [RoundChange auth 1]
        m5 <- sendMessages m4
        m5 `expectAs` [] :: StateT BlockstanbulContext IO ()

    it "Changes rounds in response to a timeout or insertion failure" $ do
      runTest $ do
        let input = [Timeout, CommitFailure "invalid hash"]
        got <- sendMessages input
        map roundchangeRound got `expectAs` [21, 21]

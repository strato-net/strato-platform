import Test.Hspec (Spec, describe, it, hspec)
import Test.Hspec.Expectations.Lifted

import Control.Monad
import Conduit
import UnliftIO.STM

import Blockchain.SeqEventNotify

main :: IO ()
main = hspec spec

spec :: Spec
spec =
  describe "sourcePriorityQueue" $ do
    it "should take high if available" $ do
      let input = [1..5]
          garbage = [200..400]
      high <- atomically newTQueue :: IO (TQueue Int)
      low <- atomically newTQueue
      runConduit $ sourcePriorityQueue high low .| do
        atomically . forM_ input $ writeTQueue high
        atomically . forM_ garbage $ writeTQueue low
        replicateM (length input) await `shouldReturn` map Just input

    it "should take low if no high available" $ do
      let input = [20..24]
      high <- atomically newTQueue :: IO (TQueue Int)
      low <- atomically newTQueue
      runConduit $ sourcePriorityQueue high low .| do
        atomically . forM_ input $ writeTQueue low
        replicateM (length input) await `shouldReturn` map Just input

    it "should flush high before taking low" $ do
      let hinput = [99..302]
          linput = [27, 26 ..0]
      high <- atomically newTQueue :: IO (TQueue Int)
      low <- atomically newTQueue
      runConduit $ sourcePriorityQueue high low .| do
        atomically . forM_ linput $ writeTQueue low
        atomically . forM_ hinput $ writeTQueue high
        replicateM (length linput + length hinput) await `shouldReturn` map Just (hinput ++ linput)

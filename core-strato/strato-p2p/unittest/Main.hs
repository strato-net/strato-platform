import Control.Monad.Trans.Reader
import Data.Time.Clock.POSIX
import Test.Hspec (hspec, Spec, describe, it)
import Test.Hspec.Expectations.Lifted

import Blockchain.HashLocks
import UnliftIO.Async

main :: IO ()
main = hspec spec

runTestClock :: (HashLocks Int -> ReaderT POSIXTime IO ()) -> IO ()
runTestClock f = do
  lock <- newHashLocks 10 :: IO (HashLocks Int)
  runReaderT (f lock) 0x80000

spec :: Spec
spec = describe "HashLocks" $ do
  it "should only allow locks on the first attempt" . runTestClock $ \h -> do
    tryGrabLock h 8888 `shouldReturn` True
    tryGrabLock h 6777 `shouldReturn` True
    tryGrabLock h 8888 `shouldReturn` False

  it "can reclaim expired entries" . runTestClock $ \h -> do
    tryGrabLock h 420 `shouldReturn` True
    local (+9.9) $ tryGrabLock h 420 `shouldReturn` False
    local (+10) $ tryGrabLock h 420 `shouldReturn` True
    local (+20) $ tryGrabLock h 420 `shouldReturn` True
    local (+22) $ tryGrabLock h 420 `shouldReturn` False

  it "should not prune entries if before the deadline" . runTestClock $  \h -> do
    totalSize h `shouldReturn` 0
    tryGrabLock h 0 `shouldReturn` True
    tryGrabLock h 1 `shouldReturn` True
    tryGrabLock h 2 `shouldReturn` True
    totalSize h `shouldReturn` 3
    prunePast h
    totalSize h `shouldReturn` 3
    local (+ 8) $ do
      prunePast h
      totalSize h `shouldReturn` 3

  it "should prune entries in the past" . runTestClock $ \h -> do
    mapM_ (tryGrabLock h) [1..40]
    totalSize h `shouldReturn` 40
    local (+20) $ do
      prunePast h
      totalSize h `shouldReturn` 0

  it "should only prune expired entries" . runTestClock $ \h -> do
    mapM_ (tryGrabLock h) [100..117]
    totalSize h `shouldReturn` 18
    local (+5) $ do
      mapM_ (tryGrabLock h) [131..140]
      totalSize h `shouldReturn` 28
    local (+10) $ do
      prunePast h
      totalSize h `shouldReturn` 10

  it "should be threadsafe" . runTestClock $ \h -> do
    ts <- mapConcurrently (tryGrabLock h) [10000..14999]
    length (filter id ts) `shouldBe` length ts
    ts' <- mapConcurrently (tryGrabLock h) [10000..14999]
    length (filter not ts') `shouldBe` length ts'

  it "should be able to grab as many locks as it can carry " . runTestClock $ \h -> do
    grabManyLocks h [0..2000] `shouldReturn` [0..2000]
    grabManyLocks h [0..2000] `shouldReturn` []
    grabManyLocks h [1000..2000] `shouldReturn` []
    grabManyLocks h [1500..2500] `shouldReturn` [2001..2500]

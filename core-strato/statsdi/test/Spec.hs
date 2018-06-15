{-# LANGUAGE FlexibleContexts      #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings     #-}
{-# LANGUAGE TemplateHaskell       #-}

import           Control.Concurrent
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Stats
import           Data.ByteString         (ByteString)
import qualified Data.ByteString         as ByteString
import qualified Data.ByteString.Char8   as Char8
import           Data.Char               (isNumber)
import           Data.Proxy
import           Data.Time.Clock.POSIX

import           Harness

import           Test.Hspec
import           Test.Tasty
import           Test.Tasty.Hspec
import           Test.Tasty.Options      (OptionDescription (..))
import           Test.Tasty.Runners      (NumThreads (..))

import Debug.Trace (traceShowId)

-- these tests effectively test the TH for sanity
-- otherwise the test suite wouldnt even compile
defineCounter "ctr.hello.world" []
defineCounter "ctr.tagged" [("env","test")]
defineGauge "gau.testing.things" []
defineTimer "time.test" []
defineHistogram "hist.stuff.things" [] 1.0
defineSet "set.of.people" []
defineServiceCheck "svc.haskell" []

ourStatsTConfig :: StatsTConfig
ourStatsTConfig = defaultStatsTConfig { flushInterval = 250 }

st :: (MonadIO m) => Int -> StatsT m a -> m ([ByteString], a)
st = st' ourStatsTConfig

st' :: (MonadIO m) => StatsTConfig -> Int -> StatsT m a -> m ([ByteString], a)
st' = runStatsTCapturingOutput

sleepMs :: MonadIO m => Int -> m ()
sleepMs = liftIO . threadDelay . (1000 *)

main :: IO ()
main = do
    putStrLn ""
    let toRun = [sillyTests, noStatsTTest, counterTests, gaugeTests, timerTests]
    forM toRun testSpecs >>= defaultMain . withTests

withTests :: [[TestTree]] -> TestTree
withTests = testGroup "Statsdi" . concat

sillyTests :: Spec
sillyTests = describe "The test harness" $ do
    it "should run and capture something (1s linger)" $ do
        (capture, _) <- st 1000 $ tick ctr_hello_world
        capture `shouldSatisfy` (not . null)

    it "should run and capture with a delay before the tick (250ms flushInterval / 1s linger / 500ms delay)" $ do
        (capture, _) <- st 1000 $ do
            sleepMs 500
            tick ctr_hello_world
        capture `shouldSatisfy` (not . null)

    it "should linger after the test runs and get everything (100ms linger / 5000ms+ test)" $ do
        (capture, _) <- st 100 $ do
            sleepMs 5000
            tick ctr_hello_world
        capture `shouldSatisfy` (not . null)

counterTests :: Spec
counterTests = describe "A Counter" $ do
    it "should have a kind tag of |c" $ do
        (capture, _) <- st 1000 $ setCounter 0 ctr_hello_world
        capture `shouldSatisfy` (not . null)
        capture `shouldSatisfy` (ByteString.isPrefixOf "ctr.hello.world:0|c" . head)

    it "should increment by one when calling `tick`" $ do
        (capture, _) <- st 1000 $ tick ctr_hello_world
        capture `shouldSatisfy` (not . null)
        capture `shouldSatisfy` (ByteString.isPrefixOf "ctr.hello.world:1|c" . head)

    it "should send a multi-event with a zeroing-out before being set to a negative number" $ do
        (capture, _) <- st 1000 $ setCounter (-20) ctr_hello_world
        capture `shouldSatisfy` (not . null)
        capture `shouldSatisfy` (ByteString.isPrefixOf "ctr.hello.world:0|c\nctr.hello.world:-20|c" . head)

gaugeTests :: Spec
gaugeTests = describe "A Gauge" $ do
    it "should have a kind tag of |g" $ do
        (capture, _) <- st 1000 $ setGauge 0 gau_testing_things
        capture `shouldSatisfy` (not . null)
        capture `shouldSatisfy` (ByteString.isPrefixOf "gau.testing.things:0|g" . head)

    it "should send a multi-event with a zeroing-out before being set to a negative number" $ do
        (capture, _) <- st 1000 $ setGauge (-20) gau_testing_things
        capture `shouldSatisfy` (not . null)
        capture `shouldSatisfy` (ByteString.isPrefixOf "gau.testing.things:0|g\ngau.testing.things:-20|g" . head)

timerTests :: Spec
timerTests = describe "A Timer" $ do
    it "should have a kind tag of |ms" $ do
        (capture, _) <- st 1000 $ time 0 time_test
        capture `shouldSatisfy` (not . null)
        capture `shouldSatisfy` (ByteString.isPrefixOf "time.test:0|ms" . head)

    it "should report in milliseconds" $ do
        (capture, _) <- st 1000 $ time 1.0 time_test
        capture `shouldSatisfy` (not . null)
        capture `shouldSatisfy` (ByteString.isPrefixOf "time.test:1000|ms" . head)

    it "should handle DiffTimes appropriately" $ do
        (capture, _) <- st 1000 $ do
            now <- liftIO getPOSIXTime
            sleepMs 250
            then' <- liftIO getPOSIXTime
            time (then' - now) time_test

        capture `shouldSatisfy` (not . null)
        capture `shouldSatisfy` (isRoughlyMillis 250 10 . head)

        where isRoughlyMillis target leeway bs = abs (actual - target) <= leeway
                    where actual = read pluckedTime
                          pluckedTime = takeWhile isNumber nameStripped
                          nameStripped = drop (ByteString.length (timerName time_test) + 1) (Char8.unpack bs)

noStatsTTest :: Spec
noStatsTTest = describe "runNoStatsT" $ do
    it "should successfully run its inner monad without any funny hiccups" $
        runNoStatsT (return ()) >>= shouldBe ()

    describe "should successfully run its inner monad even it performs Counter metrics" $ do
        it "works with tick" $
            runNoStatsT (tick ctr_hello_world) >>= shouldBe ()
        it "works with tickBy" $
            runNoStatsT (tickBy 2 ctr_hello_world) >>= shouldBe ()

    describe "should successfully run its inner monad even it performs Gauge metrics" $
        it "works with setGauge" $
            runNoStatsT (setGauge 20 gau_testing_things) >>= shouldBe ()

    describe "should successfully run its inner monad even it performs Timer metrics" $
        it "works with time" $ do
            ret <- runNoStatsT $ do
                now <- liftIO getPOSIXTime
                sleepMs 250
                then' <- liftIO getPOSIXTime
                time (then' - now) time_test
            ret `shouldBe` ()

    describe "should successfully run its inner monad even it performs Histogram metrics" $ do
        it "works with histoSample" $
            runNoStatsT (histoSample 3 hist_stuff_things) >>= shouldBe ()

        it "works with multiple calls to histoSample" $ do
            ret <- runNoStatsT $ do
                histoSample 18 hist_stuff_things
                histoSample 19 hist_stuff_things
            ret `shouldBe` ()

    describe "should successfully run its inner monad even it performs Set metrics" $ do
        it "works with addSetMember" $
            runNoStatsT (addSetMember 12 set_of_people) >>= shouldBe ()

        it "works with multiple calls to addSetMember" $ do
            ret <- runNoStatsT $ do
                addSetMember 12 set_of_people
                addSetMember 24 set_of_people
            ret `shouldBe` ()
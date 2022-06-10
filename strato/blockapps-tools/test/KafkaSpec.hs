{-# LANGUAGE OverloadedStrings #-}

import Control.Monad
import qualified Data.ByteString as B
import Data.ByteString.Arbitrary (fastRandBs)
import System.IO
import System.IO.Temp
import Test.Hspec
import Test.QuickCheck
import Text.Printf

import Kafka

testMessages :: [B.ByteString] -> SpecWith ()
testMessages msgs = it (take 70 $ printf "should be able to encode and decode %s" (show $ map B.length msgs)) $ testMessages' msgs

testMessages' :: [B.ByteString] -> IO ()
testMessages' msgs =
  withSystemTempFile "message_file.dat" $ \f h -> do
    hClose h
    withFile f WriteMode $ \wr -> mapM_ (writeMsg wr) msgs
    withFile f ReadMode $ \r -> do
      let loop :: IO [B.ByteString]
          loop = do
            mMsg <- readMsg r
            case mMsg of
              Nothing -> return []
              Just msg -> (msg:) <$> loop
      got <- loop
      got `shouldBe` msgs

main :: IO ()
main = hspec $
  describe "writeMsg/readMsg" $ do
    testMessages []
    testMessages ["hello"]
    testMessages (replicate 100 "")
    testMessages (replicate 10 "ok")
    testMessages [B.replicate 4000 0xcc]

    it "can run random strings" . replicateM_ 40 $ do
      l <- generate $ listOf (fastRandBs 10240)
      testMessages' l

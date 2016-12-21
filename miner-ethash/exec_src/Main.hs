{-# LANGUAGE OverloadedStrings, FlexibleContexts #-}

module Main where

import Control.Monad
import qualified Data.Array.IO as A
import Data.Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.ByteString.Internal
--import Data.Word
--import Foreign.Storable
import Numeric
import System.IO.MMap

import TimeIt

--import Cache
import Constants
--import Dataset
import Hashimoto

encodeWord8::Word8->String
encodeWord8 c | c < 0x20 || c > 0x7e = "\\x" ++ showHex c ""
encodeWord8 c = [w2c c]

encodeByteString::B.ByteString->String
encodeByteString = (encodeWord8 =<<) . B.unpack

word32Unpack::B.ByteString->[Word32]
word32Unpack s | B.null s = []
word32Unpack s | B.length s >= 4 = decode (BL.fromStrict $ B.take 4 s) : word32Unpack (B.drop 4 s)
word32Unpack _ = error "word32Unpack called for ByteString of length not a multiple of 4"


main :: IO ()
main = do
--  cache <- mkCache (fromIntegral $ cacheSize 0) $ B.replicate 32 0
--  let dataset = calcDataset (fullSize 0) cache


  let fullSize' = fromIntegral $ fullSize 0
      --getItem = calcDatasetItem cache . fromIntegral
      block = B.pack [1,2,3,4]
      nonce = B.pack [1,2,3,4]

  s <- mmapFileByteString "qqqq" Nothing

  let getItem' i = A.newListArray (0,15) $ word32Unpack $ B.take 64 $ B.drop (64 * fromIntegral i) s

  timeIt $ do
    forM_ [0..15000::Integer] $ \_ -> do 
      (mixDigest, result) <- hashimoto block nonce fullSize' (getItem') -- getItem
      putStrLn $ "mixDigest: " ++ encodeByteString mixDigest
      putStrLn $ "result: " ++ encodeByteString result
      return ()

{-# LANGUAGE OverloadedStrings #-}

module Main where

import Blockchain.Data.RLP
import qualified Data.ByteString as B
import Data.Word
import Test.Framework
import Test.Framework.Providers.HUnit
import Test.HUnit
import Test.Hspec

rlpSerialize_list :: RLPObject -> B.ByteString
rlpSerialize_list = B.pack . rlp2Bytes

rlp2Bytes :: RLPObject -> [Word8]
rlp2Bytes (RLPScalar val) = [fromIntegral val]
rlp2Bytes (RLPString s) | B.length s <= 55 = 0x80 + fromIntegral (B.length s) : B.unpack s
rlp2Bytes (RLPString s) =
  [0xB7 + fromIntegral (length lengthAsBytes)] ++ lengthAsBytes ++ B.unpack s
  where
    lengthAsBytes = int2Bytes $ B.length s
rlp2Bytes (RLPArray innerObjects) =
  if length innerBytes <= 55
    then 0xC0 + fromIntegral (length innerBytes) : innerBytes
    else
      let lenBytes = int2Bytes $ length innerBytes
       in [0xF7 + fromIntegral (length lenBytes)] ++ lenBytes ++ innerBytes
  where
    innerBytes = concat $ rlp2Bytes <$> innerObjects

testNumber :: Assertion
testNumber = do
  let n = 20 :: Integer
  assertEqual "rlp encoding failed for small number" (rlpDecode $ rlpDeserialize $ rlpSerialize $ rlpEncode n) n

testConsistent :: RLPObject -> Expectation
testConsistent obj =
  let oldEnc = rlpSerialize_list obj
      newEnc = rlpSerialize obj
   in newEnc `shouldBe` oldEnc

main :: IO ()
main =
  defaultMainWithOpts
    [ testCase "test RLP number encoding" testNumber,
      testCase "test numbers" . mapM_ (testConsistent . RLPScalar) $ [0 .. 255],
      testCase "test strings" . mapM_ (testConsistent . RLPString . flip B.replicate 0xfa) $
        [0, 10, 55, 56, 1024, 1024 * 1024]
    ]
    mempty

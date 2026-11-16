{-# LANGUAGE OverloadedStrings #-}

-- | What one peer message can make this node allocate.
module Main where

import Blockchain.CommunicationConduit (maxMessageItems, rlpItemsAtMost)
import Blockchain.Data.RLP
import Blockchain.Event (requestedHeaderNumbers)
import qualified Data.ByteString as B
import Test.Hspec

-- | A list of @n@ one-byte items: the cheapest way to make a decoder build many objects.
ones :: Int -> B.ByteString
ones n = rlpSerialize . RLPArray $ replicate n (RLPScalar 1)

main :: IO ()
main = hspec $ do
  describe "rlpItemsAtMost" $ do
    it "counts every item at every depth, lists included" $ do
      -- the outer list, "abc", the inner list, 1, a long string, 2: six items
      let enc = rlpSerialize $ RLPArray [RLPString "abc", RLPArray [RLPScalar 1, RLPString (B.replicate 60 7)], RLPScalar 2]
      rlpItemsAtMost 6 enc `shouldBe` True
      rlpItemsAtMost 5 enc `shouldBe` False

    it "refuses a message of one-byte items past the cap" $ do
      rlpItemsAtMost 1001 (ones 1000) `shouldBe` True
      rlpItemsAtMost 1000 (ones 1000) `shouldBe` False

    it "lets a message the size of the largest one a peer may send through" $
      -- 16 MiB of 32-byte strings, more bytes per item than a one-byte flood
      rlpItemsAtMost maxMessageItems (rlpSerialize . RLPArray $ replicate (2 ^ (24 :: Int) `div` 33) (RLPString $ B.replicate 32 9)) `shouldBe` True

    it "refuses an item whose declared length runs past the end" $ do
      rlpItemsAtMost 10 (B.pack [0xB9, 0xFF, 0xFF, 1, 2]) `shouldBe` False
      -- a length past maxBound Int, which the decoder would narrow to an empty
      -- string while the items after it went uncounted
      rlpItemsAtMost 10 (B.pack (0xC9 : 0xBF : replicate 8 0xFF) <> ones 20) `shouldBe` False
      rlpItemsAtMost 10 (B.pack [0xF9, 0xFF, 0xFF, 1]) `shouldBe` False

  describe "requestedHeaderNumbers" $ do
    it "asks for consecutive numbers when nothing is skipped" $
      requestedHeaderNumbers 500 10 3 0 `shouldBe` [10, 11, 12]

    it "caps the count and strides by the skip" $
      requestedHeaderNumbers 2 10 5 3 `shouldBe` [10, 14]

    it "looks up no more numbers for an enormous skip" $
      requestedHeaderNumbers 500 1 3 maxBound `shouldBe` [1, 2 + toInteger (maxBound :: Int), 3 + 2 * toInteger (maxBound :: Int)]

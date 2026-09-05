{-# LANGUAGE OverloadedStrings #-}

import Blockchain.Data.LogsBloom
import Data.Bits (testBit)
import qualified Data.ByteString as B
import Data.List (sort)
import Test.Hspec

-- | Bit indices set in a big-endian bloom (bit 0 = LSB of the last byte).
setBits :: B.ByteString -> [Int]
setBits bs =
  sort
    [ (B.length bs - 1 - byteIx) * 8 + bitInByte
    | byteIx <- [0 .. B.length bs - 1]
    , bitInByte <- [0 .. 7]
    , testBit (B.index bs byteIx) bitInByte
    ]

main :: IO ()
main = hspec spec

spec :: Spec
spec = describe "Blockchain.Data.LogsBloom" $ do
  it "produces a 256-byte filter" $
    B.length (bloomFromItems [B.empty]) `shouldBe` 256

  it "is all zeros for no logs" $
    computeLogsBloom [] `shouldBe` emptyLogsBloom

  it "emptyLogsBloom is 256 zero bytes" $
    (B.length emptyLogsBloom, B.all (== 0) emptyLogsBloom) `shouldBe` (256, True)

  -- keccak256("") = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
  -- first six bytes c5 d2 46 01 86 f7 give bit indices:
  --   (0xc5d2 & 2047)=1490, (0x4601 & 2047)=1537, (0x86f7 & 2047)=1783
  it "sets exactly the three Yellow-Paper bits for item = \"\"" $
    setBits (bloomFromItems [B.empty]) `shouldBe` [1490, 1537, 1783]

  it "OR-composes: union of two items equals combining their bits" $ do
    let a = B.pack [1, 2, 3]
        b = B.pack [4, 5, 6]
        combined = setBits (bloomFromItems [a, b])
        union' = sort (setBits (bloomFromItems [a]) ++ setBits (bloomFromItems [b]))
    combined `shouldBe` sort (foldr (\x acc -> if x `elem` acc then acc else x : acc) [] union')

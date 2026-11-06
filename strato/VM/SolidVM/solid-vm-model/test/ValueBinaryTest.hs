{-# LANGUAGE OverloadedStrings #-}

module ValueBinaryTest (spec) where

import Blockchain.Strato.Model.Address (Address (..))
import Data.Binary (decode, encode)
import qualified Data.Aeson as JSON
import Blockchain.Data.RLP (rlpEncode)
import qualified Data.Map as M
import qualified Data.Vector as V
import SolidVM.Model.Value
import Test.Hspec

-- Value has no Eq, so compare the derived Show.
roundTrips :: Value -> Expectation
roundTrips v = show (decode (encode v) :: Value) `shouldBe` show v

spec :: Spec
spec = describe "Binary Value round trip" $ do
  it "scalars" $ do
    roundTrips $ SInteger (-12345678901234567890)
    roundTrips $ SUnsigned 0
    roundTrips $ SUnsigned (2 ^ (300 :: Int))
    roundTrips $ SDecimal 1.25
    roundTrips $ SString "quotes \" and unicode \955 \128512"
    roundTrips $ SBool True
    roundTrips $ SAddress (Address 0xdeadbeef) True
    roundTrips $ SEnumVal "Color" "Red" 2
    roundTrips $ SContract "Token" (Address 1)
    roundTrips $ SBytes "\0\1\2\255"
    roundTrips SNULL
  it "aggregates" $ do
    roundTrips $ SStruct "S" (M.fromList [("a", Constant (SInteger 1)), ("b", Constant (SString "x"))])
    roundTrips $ STuple (V.fromList [Constant (SBool False), Constant SNULL])
    roundTrips $ SArray (V.fromList [Constant (SArray (V.fromList [Constant (SInteger 7)]))])
  it "uses the same numeric keys for signed and unsigned values" $ do
    SUnsigned 7 `shouldBe` SInteger 7
    compare (SUnsigned 7) (SInteger 7) `shouldBe` EQ
    M.lookup (SInteger 7) (M.singleton (SUnsigned 7) True) `shouldBe` Just True
  it "preserves existing numeric RLP and JSON encodings" $
    mapM_ (\n -> do
      let signed = SInteger n
          unsigned = unsignedInteger n
      rlpEncode unsigned `shouldBe` rlpEncode signed
      JSON.encode unsigned `shouldBe` JSON.encode signed)
      [0, 1, 255, 256, 2 ^ (300 :: Int)]

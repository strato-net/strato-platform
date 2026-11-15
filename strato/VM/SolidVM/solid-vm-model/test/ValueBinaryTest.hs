{-# LANGUAGE OverloadedStrings #-}

module ValueBinaryTest (spec) where

import Blockchain.Strato.Model.Address (Address (..))
import Blockchain.VM.SolidException
import Control.Exception (displayException, toException)
import Text.Format (format)
import SolidVM.Model.Storable (BasicValue (..))
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

  it "preserves compact diagnostics alongside the existing full value renderer" $ do
    format (SInteger 7) `shouldBe` "Integer(7)"
    renderValueShallow (SInteger 7) `shouldBe` "7"
    renderValueShallow (SString "abcdefghijklmnopqrstuvwxyz") `shouldBe` "\"abcdefghijklmnopqrstuvwxyz\""
    renderValueShallow (SAddress (Address 0xdeadbeef) True) `shouldBe` "00000000000000000000000000000000deadbeef"
    renderValueShallow (SArray (V.fromList [Constant (SInteger 7)])) `shouldBe` "<array>"
    format (SBool True) `shouldBe` "Bool(True)"
    format (SString "abcdefghijklmnopqrstuvwxyz") `shouldBe` "String(\"abcdefghijklmnopqrst\"...)"
    format (SAddress (Address 0xdeadbeef) True) `shouldBe` "Address(0000000000...)"
    format (SArray (V.fromList [Constant (SInteger 7)])) `shouldBe` "Array"
    format (SFunction "transfer" Nothing) `shouldBe` "Function(\"transfer\")"
    renderValue (SString "abcdefghijklmnopqrstuvwxyz") `shouldBe` "abcdefghijklmnopqrstuvwxyz"
    renderValue (SArray (V.fromList [Constant (SString "message"), Constant (SInteger 7)])) `shouldBe` "[\"message\", 7]"
    renderValue (SStruct "Details" (M.singleton "reason" (Constant (SString "denied")))) `shouldBe` "Details{\"reason\": \"denied\"}"
    renderValue (SBytes "\0\255") `shouldBe` "00ff"
    show (SString "message") `shouldBe` "SString \"message\""

  it "renders require, revert and custom errors as readable messages" $ do
    displayException (InternalError "broken invariant: details") `shouldBe` "internal error: broken invariant: details"
    displayException (UnsupportedFeature "delete of a local variable" "x") `shouldBe` "unsupported SolidVM feature: delete of a local variable: x"
    displayException (Require (Just "denied")) `shouldBe` "solidity require failed: denied"
    displayException (RevertError "REVERT" "denied") `shouldBe` "denied"
    displayException (RevertError "REVERT" "") `shouldBe` "transaction reverted"
    displayException (CustomError "Reverting based on Error Method:" "Denied" [BString "not allowed", BInteger 7]) `shouldBe` "Denied(not allowed, 7)"

  it "uses standard exception rendering through SomeException" $ do
    displayException (toException (RevertError "REVERT" "quoted \"message\" and \955"))
      `shouldBe` "quoted \"message\" and \955"
    show (RevertError "REVERT" "denied") `shouldBe` "revert: REVERT denied:"

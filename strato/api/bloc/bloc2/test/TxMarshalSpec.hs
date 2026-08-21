{-# LANGUAGE OverloadedStrings #-}

-- | Golden tests for the shared tx-marshaling helpers: the wallet-wrapping
-- ArgValue maps and the ArgValue → Solidity-literal rendering that both
-- posting and simulation rely on.
module TxMarshalSpec (spec) where

import Bloc.Server.Transaction (walletWrapCall, walletWrapCreate)
import BlockApps.Solidity.ArgValue
import BlockApps.Solidity.Value
import Blockchain.Strato.Model.Address (Address (..))
import qualified Data.Map.Strict as M
import Data.Source.Map (SourceMap (..))
import qualified Data.Vector as V
import Test.Hspec

spec :: Spec
spec = do
  describe "walletWrapCreate" $
    it "builds the exact User.createContract arg map" $ do
      let src = SourceMap [("a.sol", "contract C { constructor(uint x) {} }")]
      walletWrapCreate "C" src ["42"]
        `shouldBe` M.fromList
          [ ("contractName", ArgString "C"),
            ("contractSrc", ArgString "contract C { constructor(uint x) {} }"),
            ("args", ArgArray $ V.fromList [ArgString "42"])
          ]

  describe "walletWrapCall" $
    it "builds the exact User.callContract arg map" $
      walletWrapCall (Address 0xdeadbeef) "transfer" [ArgString "\"00000000000000000000000000000000deadbeef\"", ArgString "100"]
        `shouldBe` M.fromList
          [ ("contractToCall", ArgString "00000000000000000000000000000000deadbeef"),
            ("functionName", ArgString "transfer"),
            ("args", ArgArray $ V.fromList [ArgString "\"00000000000000000000000000000000deadbeef\"", ArgString "100"])
          ]

  describe "valueToTexts (Solidity literal rendering)" $ do
    it "renders strings quoted and escaped" $
      valueToTexts (SimpleValue . ValueString $ "he said \"hi\\there\"")
        `shouldBe` ["\"he said \\\"hi\\\\there\\\"\""]
    it "renders bools bare" $ do
      valueToTexts (SimpleValue $ ValueBool True) `shouldBe` ["true"]
      valueToTexts (SimpleValue $ ValueBool False) `shouldBe` ["false"]
    it "renders ints bare" $
      valueToTexts (SimpleValue $ valueUInt 255) `shouldBe` ["255"]
    it "renders addresses quoted without 0x" $
      valueToTexts (SimpleValue . ValueAddress $ Address 0xdeadbeef)
        `shouldBe` ["\"00000000000000000000000000000000deadbeef\""]
    it "renders dynamic arrays bracketed" $
      valueToTexts (ValueArrayFixed 2 [SimpleValue $ valueUInt 1, SimpleValue $ valueUInt 2])
        `shouldBe` ["[1,2]"]
    it "flattens variadic values into multiple args" $
      valueToTexts (ValueVariadic [SimpleValue $ valueUInt 1, SimpleValue . ValueString $ "x"])
        `shouldBe` ["1", "\"x\""]

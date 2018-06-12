{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.Parse.PragmaSpec where

import           Data.Either
import           Test.Hspec
import           Text.Parsec

import           BlockApps.Solidity.Parse.Pragmas
import           BlockApps.Solidity.Parse.ParserTypes

spec :: Spec
spec = do
  let pragmaParse = runParser solidityPragma "" ""
  describe "Pragma" $ do
    it "should fail without an identifier" $
      pragmaParse "pragma;" `shouldSatisfy` isLeft
    it "should fail without contents" $
      pragmaParse "pragma ident  ;" `shouldSatisfy` isLeft
    it "shoudl fail without a ;" $ do
      pragmaParse "pragma solc 0.4.8" `shouldSatisfy` isLeft
    it "should pass with arbitrary text" $
      pragmaParse "pragma randident don't fsck with my t3xt !!;" `shouldBe`
        Right (Pragma "randident" "don't fsck with my t3xt !!")


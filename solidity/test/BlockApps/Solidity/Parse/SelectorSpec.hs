{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.Parse.SelectorSpec where

import           Data.ByteString                   (ByteString)
import qualified Data.ByteString.Base16            as Base16
import           Data.Text                         (Text)
import           Test.Hspec

import           BlockApps.Solidity.Parse.Selector
import           BlockApps.Solidity.Type

spec :: Spec
spec =
  describe "Selector" $ do
    it "should generate a selector for a function with no arguments" $
      generateSelector [] "doit" [] "4d536fe3"
    it "should generate a selector for a function with one int argument" $
      generateSelector [] "doit" [SimpleType TypeInt] "45db85b8"
    it "should generate a selector for a function with three varied intN arguments" $
      generateSelector [] "doit" (map SimpleType [TypeInt8, TypeInt48, TypeInt200]) "31f92024"


generateSelector :: [(Text, Int)]->Text->[Type]->ByteString -> Expectation
generateSelector enumSizes name args expectedSelector = do
  let selector = deriveSelector enumSizes name args
  Base16.encode selector `shouldSatisfy` (== expectedSelector)

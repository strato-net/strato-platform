module BlockApps.Solidity.Parse.TypesSpec where

import BlockApps.Solidity.Parse.Types
import BlockApps.Solidity.Parse.UnParser
import BlockApps.Solidity.Xabi.Type
import Test.Hspec
import Text.Parsec hiding (parse)

spec :: Spec
spec = do
  describe "Types - Array" $ do
    let arrParse = runParser arrayType "" ""
    let uint = Int (Just False) Nothing
    it "parses dynamic arrays" $
      arrParse "uint[]" `shouldBe` Right (Array uint Nothing)
    it "parses static arrays" $
      arrParse "uint[300]" `shouldBe` Right (Array uint (Just 300))
    it "parses arrays of arrays" $
      arrParse "uint[20][40]" `shouldBe` Right (Array (Array uint (Just 20)) (Just 40))

    it "unparses dynamic arrays" $
      unparseVarType (Array uint Nothing) `shouldBe` "uint[]"
    it "unparses static arrays" $
      unparseVarType (Array uint (Just 776)) `shouldBe` "uint[776]"
    it "unparses nested arrays" $
      unparseVarType (Array (Array uint Nothing) Nothing) `shouldBe` "uint[][]"

  describe "Types - integer" $ do
    let intParse = runParser simpleType "" ""
    it "parses uint" $
      intParse "uint" `shouldBe` Right (Int (Just False) Nothing)
    it "parses int" $
      intParse "int" `shouldBe` Right (Int (Just True) Nothing)
    it "parses uint32 " $
      intParse "uint32" `shouldBe` Right (Int (Just False) (Just 4))

    it "unparses uint" $
      unparseVarType (Int (Just False) Nothing) `shouldBe` "uint"
    it "unparses int" $
      unparseVarType (Int (Just True) Nothing) `shouldBe` "int"
    it "unparses int64" $
      unparseVarType (Int (Just True) (Just 8)) `shouldBe` "int64"

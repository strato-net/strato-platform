{-# LANGUAGE
      OverloadedStrings
#-}

module BlockApps.Solidity.Parse.SelectorSpec where

import Data.ByteString (ByteString)
import qualified Data.ByteString.Base16 as Base16
import Data.Text (Text)
import Test.Hspec

import BlockApps.Solidity.Parse.Selector
import BlockApps.Solidity.Type

spec :: Spec
spec = do
  describe "Selector" $ do
    it "should generate a selector for a function with no arguments" $ do
      generateSelector [] "doit" [] "4d536fe3"
    it "should generate a selector for a function with one int argument" $ do
      generateSelector [] "doit" [SimpleType TypeInt] "45db85b8"
    it "should generate a selector for a function with three varied intN arguments" $ do
      generateSelector [] "doit" (map SimpleType [TypeInt8, TypeInt48, TypeInt200]) "31f92024"

    it "should generate a selector for a function with one uint argument" $ do
      generateSelector [] "goForIt" [SimpleType TypeUInt] "e7b3ef24"
    it "should generate a selector for a function with three varied uintN arguments" $ do
      generateSelector [] "goForIt" (map SimpleType [TypeUInt8, TypeUInt48, TypeUInt200]) "2a17bbf5"
      
    it "should generate a selector for a function with one bytes argument" $ do
      generateSelector [] "makeItHappen" [SimpleType TypeBytes] "3aae8c6c"
    it "should generate a selector for a function with three varied bytesN arguments" $ do
      generateSelector [] "makeItHappen" (map SimpleType [TypeBytes1, TypeBytes10, TypeBytes20]) "f719f0c1"
      
    it "should generate a selector for a function with one string argument" $ do
      generateSelector [] "f" [SimpleType TypeString] "91e145ef"
      
    it "should generate a selector for a function with one fixed array argument" $ do
      generateSelector [] "doit" [TypeArrayFixed 10 (SimpleType TypeInt)] "76be8dcc"
    it "should generate a selector for a function with one dynamic array argument" $ do
      generateSelector [] "doit" [TypeArrayDynamic (SimpleType TypeString)] "2a146d1b"
    it "should generate a selector for a function with one mapping argument" $ do
      generateSelector [] "doit" [TypeMapping TypeInt (SimpleType TypeString)] "9864b05b"
    it "should generate a selector for a function with one enum argument" $ do
      generateSelector [("Pets", 4)] "doit" [TypeEnum "Pets"] "941d86aa"


generateSelector :: [(Text, Int)]->Text->[Type]->ByteString -> Expectation
generateSelector enumSizes name args expectedSelector = do
  let selector = deriveSelector enumSizes name args
  Base16.encode selector `shouldBe` expectedSelector


{-
formatArg typesL (Mapping d c) =
  text "mapping" <+> parens (pretty typesL d <+> text "=>" <+> pretty typesL c)
formatArg typesL (Typedef name) = 
  case typesL Map.! name of
    EnumLayout s -> pretty typesL (UnsignedInt s)
    _ -> text name -}

{-# LANGUAGE OverloadedStrings #-}

-- | Test for Bug #5727: STRATO API doesn't handle strings with quotes inside of them
--
-- The bug manifests as:
-- RuntimeError (PersistMarshalError "Couldn't parse field `value` from table `storage`.
--   malformed value string in call to fromPersistValue: \"\\\"\\\"\\\\\\\"Deposited\\\"\\\"\\\"\"")
module BasicValueStringTest (spec) where

import Database.Persist.Class (PersistField (..))
import SolidVM.Model.Storable (BasicValue (..), basicParse)
import Test.Hspec
import Text.Format (format)

spec :: Spec
spec = do
  describe "Bug #5727: BasicValue string formatting and parsing" $ do
    -- PersistField instance tests (toPersistValue/fromPersistValue roundtrip)
    -- This is the actual code path that triggers the bug in production
    describe "PersistField instance (database roundtrip)" $ do
      it "roundtrips simple string through toPersistValue/fromPersistValue" $ do
        let bv = BString "hello"
        fromPersistValue (toPersistValue bv) `shouldBe` Right bv

      it "roundtrips string with quotes through toPersistValue/fromPersistValue" $ do
        -- This is the exact bug scenario: storing "Deposited" (with quotes) in the database
        let bv = BString "\"Deposited\""
        fromPersistValue (toPersistValue bv) `shouldBe` Right bv

      it "roundtrips string with triple quotes through toPersistValue/fromPersistValue" $ do
        -- The exact error pattern from bug report: """Deposited"""
        let bv = BString "\"\"\"Deposited\"\"\""
        fromPersistValue (toPersistValue bv) `shouldBe` Right bv

      it "roundtrips JSON-like string through toPersistValue/fromPersistValue" $ do
        let bv = BString "{\"action\": \"Deposited\"}"
        fromPersistValue (toPersistValue bv) `shouldBe` Right bv


    -- Quote tests - these demonstrate the bug
    describe "strings with embedded quotes (bug reproduction)" $ do
      it "roundtrips string with embedded double quote" $ do
        let bv = BString "say \"hello\""
        basicParse (format bv) `shouldBe` Just bv

      it "roundtrips string wrapped in quotes" $ do
        let bv = BString "\"Deposited\""
        basicParse (format bv) `shouldBe` Just bv

      it "roundtrips string with triple quotes" $ do
        let bv = BString "\"\"\"Deposited\"\"\""
        basicParse (format bv) `shouldBe` Just bv

      it "roundtrips string that is just a quote" $ do
        let bv = BString "\""
        basicParse (format bv) `shouldBe` Just bv

      it "roundtrips string with quote at beginning" $ do
        let bv = BString "\"Deposited"
        basicParse (format bv) `shouldBe` Just bv

      it "roundtrips string with quote at end" $ do
        let bv = BString "Deposited\""
        basicParse (format bv) `shouldBe` Just bv

      it "roundtrips string with multiple separate quotes" $ do
        let bv = BString "\"a\" \"b\" \"c\""
        basicParse (format bv) `shouldBe` Just bv

      it "roundtrips consecutive quotes" $ do
        let bv = BString "\"\"\"\""
        basicParse (format bv) `shouldBe` Just bv

    -- Backslash and quote combinations
    describe "strings with backslash and quotes" $ do
      it "roundtrips string with backslash" $ do
        let bv = BString "back\\slash"
        basicParse (format bv) `shouldBe` Just bv

      it "roundtrips string with backslash-quote sequence" $ do
        let bv = BString "\\\""
        basicParse (format bv) `shouldBe` Just bv

      it "roundtrips string with backslash and quotes" $ do
        let bv = BString "\\\"Deposited\\\""
        basicParse (format bv) `shouldBe` Just bv

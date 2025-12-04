{-# LANGUAGE OverloadedStrings #-}

-- | Test for Bug #5727: STRATO API doesn't handle strings with quotes inside of them
--
-- The bug manifests as:
-- RuntimeError (PersistMarshalError "Couldn't parse field `value` from table `storage`.
--   malformed value string in call to fromPersistValue: \"\\\"\\\"\\\\\\\"Deposited\\\"\\\"\\\"\"")
module BasicValueStringTest (spec) where

import Database.Persist.Class (PersistField (..))
import SolidVM.Model.Storable (BasicValue (..))
import Test.Hspec

spec :: Spec
spec = do
  xdescribe "Bug #5727: BasicValue string formatting and parsing" $ do
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

{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

-- | Regression tests for the unconditional 'Blockchain.SolidVM.ImportResolver'
-- audit fixes:
--
--   * Audit finding 40: 'mergeUnresolvedFileUnits' rejects duplicate
--     contract names (the 'Semigroup' instance now uses the *checked*
--     merge rather than a left-biased union).
--   * Audit finding 47: 'doResolve' threads its updated @seen@ set
--     across sibling imports so a cycle (or a sibling already
--     resolved by a previous branch) is detected — the test
--     constructs a two-file mutual-import cycle and asserts it
--     terminates.
--   * Audit finding 52: 'resolveImports' fails hard when an
--     'AddressLiteral' import points at an account that doesn't exist
--     on chain (matching the existing 'StringLiteral' missing-file
--     behaviour).
--
-- ImportResolver was previously in @other-modules@; we exposed it from
-- the library so this spec can import it directly.
module ImportResolverAuditFixSpec (spec) where

import Blockchain.Data.AddressStateDB (AddressState)
import Blockchain.SolidVM.ImportResolver
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Control.Lens
import qualified Control.Monad.Change.Alter as A
import Control.Monad.IO.Class
import Control.Monad.Trans.Except (runExceptT)
import Data.Default (def)
import qualified Data.Map.Strict as Map
import qualified Data.Text as T
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.CodeCollection.Statement (ExpressionF (..))
import SolidVM.Model.CodeCollection.Import (FileImportF (..))
import Test.Hspec

----------------------------------------------------------------------
-- A minimal monad with the Selectable instances that 'resolveImports'
-- requires. Both lookups always return Nothing — exactly the scenario
-- audit findings 52 (missing on-chain code) and 47 (cycle detection)
-- exercise.

newtype TestM a = TestM { runTestM :: IO a }
  deriving (Functor, Applicative, Monad, MonadIO)

instance A.Selectable Address AddressState TestM where
  select _ _ = pure Nothing

instance A.Selectable FilePath (Either String String) TestM where
  select _ _ = pure Nothing

----------------------------------------------------------------------
-- Fixtures

-- | A unit map containing one entry named "Foo" — a plain default
-- contract is fine for the duplicate-detection test, we don't actually
-- compile it.
fooUnit :: UnresolvedFileUnitsF ()
fooUnit = def & ufuUnits . at "Foo" ?~ FUContract def

-- | A unit map with no overlap with 'fooUnit'.
barUnit :: UnresolvedFileUnitsF ()
barUnit = def & ufuUnits . at "Bar" ?~ FUContract def

-- | Same key as 'fooUnit', different (but value-equal) contract — that
-- still trips the duplicate check because 'Bar' is not a function with
-- a different signature.
fooUnitTwin :: UnresolvedFileUnitsF ()
fooUnitTwin = def & ufuUnits . at "Foo" ?~ FUContract def

-- | A 'getCCFromHash' stub. Anything that calls this in our test means
-- the resolver hit a hash-based codepath we didn't expect.
unusedGetCC :: Keccak256 -> TestM (CC.CodeCollectionF ())
unusedGetCC h = error $ "ImportResolver test asked for code at hash " ++ show h

-- | A 'getNamedSUnits' stub — used only by the StringLiteral path,
-- not the AddressLiteral path that #52 exercises.
unusedGetNamed :: T.Text -> T.Text -> Maybe (UnresolvedFileUnitsF ())
unusedGetNamed _ _ = Nothing

-- | A UFU whose only import is an AddressLiteral pointing at an
-- on-chain address that our 'TestM' Selectable instance returns
-- Nothing for. Pre-fix the resolver silently dropped this; post-fix
-- it should produce a Left.
ufuWithDeadAddrImport :: UnresolvedFileUnitsF ()
ufuWithDeadAddrImport =
  def & ufuImports .~ [Simple (AddressLiteral () (Address 0xdeadbeef)) ()]

-- | A UFU representing @import "B.sol";@.
ufuImportingB :: UnresolvedFileUnitsF ()
ufuImportingB =
  def & ufuImports .~ [Simple (StringLiteral () "B.sol") ()]

-- | A UFU representing @import "A.sol";@.
ufuImportingA :: UnresolvedFileUnitsF ()
ufuImportingA =
  def & ufuImports .~ [Simple (StringLiteral () "A.sol") ()]

----------------------------------------------------------------------
-- spec

spec :: Spec
spec = do
  describe "Audit finding 40: mergeUnresolvedFileUnits is checked" $ do
    it "non-overlapping unit maps merge cleanly" $ do
      case mergeUnresolvedFileUnits fooUnit barUnit of
        Left e -> expectationFailure $ "expected Right; got Left: " ++ T.unpack e
        Right merged ->
          Map.keysSet (merged ^. ufuUnits) `shouldBe` Map.keysSet (Map.fromList [("Foo", ()), ("Bar", ())])

    it "duplicate non-function unit names produce Left" $ do
      case mergeUnresolvedFileUnits fooUnit fooUnitTwin of
        Right _ -> expectationFailure "expected Left; merge silently accepted duplicate"
        Left msg ->
          T.isPrefixOf "Duplicate values" msg
            `shouldBe` True

    it "the Semigroup instance routes through the checked merge" $ do
      -- The audit fix replaced the left-biased '<>' on UFU with one
      -- that uses 'mergeUnresolvedFileUnits' and 'error's on a Left.
      -- Confirm a duplicate-laden '<>' actually raises (rather than
      -- silently picking the left).
      let dup = fooUnit <> fooUnitTwin :: UnresolvedFileUnitsF ()
      -- Force evaluation of the resulting map; the error fires inside
      -- the Semigroup body when we touch the merged units field.
      shouldThrow
        (case dup ^. ufuUnits of m -> m `seq` pure () :: IO ())
        anyErrorCall

  describe "Audit finding 52: AddressLiteral missing on-chain code is a hard error" $ do
    it "resolveImports of an AddressLiteral pointing at empty state returns Left" $ do
      let initial = Map.singleton ("test.sol" :: T.Text) ufuWithDeadAddrImport
      result <- runTestM $
        runExceptT (resolveImports unusedGetCC unusedGetNamed initial)
      case result of
        Right _ ->
          expectationFailure
            "resolveImports unexpectedly succeeded for a missing on-chain address import"
        Left (_, msg) ->
          T.isInfixOf "address" msg `shouldBe` True

  describe "Audit finding 47: import-cycle detection terminates" $ do
    it "two-file mutual import cycle resolves without looping" $ do
      -- File A imports B, file B imports A. With the seen-set
      -- threading in 'doResolve' (and the fileName check at the top of
      -- 'resolveFile'), this must terminate. Pre-fix-of-#47 the
      -- *sibling* tracking was buggy, but the basic two-file cycle
      -- was already protected — this test mostly guards against any
      -- future regression that drops the seen-set check entirely.
      let initial =
            Map.fromList
              [ ("A.sol" :: T.Text, ufuImportingB)
              , ("B.sol", ufuImportingA)
              ]
      result <- runTestM $
        runExceptT (resolveImports unusedGetCC unusedGetNamed initial)
      case result of
        Left (_, msg) ->
          expectationFailure $
            "expected Right (cycle should terminate cleanly); got Left: "
              ++ T.unpack msg
        Right _ -> pure ()

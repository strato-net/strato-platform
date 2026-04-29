{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}

-- | Regression tests for the unconditional model-side fixes from the
-- 2026 Consensys Diligence audit.  See 'Blockchain.VM.ForkGate' for the
-- gated subset that is *not* covered here (those flips happen at a
-- specific block on Helium/Upquark and are exercised by the
-- fork-boundary test).
module AuditFixSpec (spec) where

import qualified Blockchain.Data.RLP as RLP
import qualified Blockchain.VM.ForkGate as ForkGate
import Blockchain.VM.SolidException
import Control.Exception (evaluate)
import qualified Data.ByteString as B
import Data.Default (def)
import qualified Data.Map.Strict as Map
import Data.String (fromString)
import qualified SolidVM.Model.CodeCollection as CC
import qualified SolidVM.Model.CodeCollection.Contract as Contract
import qualified SolidVM.Model.Storable as MS
import qualified SolidVM.Model.Type as SVMType
import SolidVM.Model.Value
import Test.Hspec

-- | Build a contract with one enum @Status { A, B, C }@.
mkEnumContract :: Contract.Contract
mkEnumContract =
  let baseC = def :: Contract.Contract
      enums' = Map.insert "Status" (["A", "B", "C"], def) (Contract._enums baseC)
   in baseC { Contract._enums = enums' }

emptyCC :: CC.CodeCollection
emptyCC = def

isTypeError :: SolidException -> Bool
isTypeError (TypeError _ _) = True
isTypeError _               = False

isStorableMalformed :: MS.StorableException -> Bool
isStorableMalformed MS.StorableMalformedData {} = True
isStorableMalformed _                           = False

isStorableInternal :: MS.StorableException -> Bool
isStorableInternal MS.StorableInternalError {} = True
isStorableInternal _                           = False

isStorableParseErr :: MS.StorableException -> Bool
isStorableParseErr MS.StorableParseError {} = True
isStorableParseErr _                        = False

spec :: Spec
spec = do
  -- Audit finding 27: BasicValue's FromJSON parse path is fed each value
  -- string by 'basicParse'. Before the fix, an unmatched input returned
  -- 'Nothing' which json-stream silently swallows ("Nothing parsed."
  -- with no diagnostic). 'basicParse' is now total — it always returns
  -- 'Just' with a 'BString' fallback for unrecognised inputs.
  describe "Audit finding 27: basicParse is total" $ do
    it "recognised inputs still parse to their richer constructor" $ do
      MS.basicParse "true"  `shouldBe` Just (MS.BBool True)
      MS.basicParse "false" `shouldBe` Just (MS.BBool False)
      MS.basicParse "42"    `shouldBe` Just (MS.BInteger 42)

    it "garbage input falls back to BString instead of Nothing" $ do
      let garbage = "this is not a basic value at all !!! @@@"
      case MS.basicParse garbage of
        Just (MS.BString _) -> pure ()
        other ->
          expectationFailure $
            "basicParse should always return Just on garbage; got: "
              ++ show other

    it "empty string is parseable (never Nothing)" $ do
      MS.basicParse "" `shouldSatisfy` \r -> case r of
        Just _  -> True
        Nothing -> False

  -- Audit finding 25: 'StoragePath' parsing/serialisation paths used
  -- bare 'error' calls. They now throw a typed 'StorableException'
  -- which 'runSM' surfaces as an 'InternalError' instead of crashing
  -- the VM thread.
  describe "Audit finding 25: StoragePath errors are typed" $ do
    it "parsePath returns Left on malformed input rather than crashing" $ do
      MS.parsePath "[unmatched" `shouldSatisfy` either (const True) (const False)

    it "fromString @StoragePath throws StorableParseError on garbage" $ do
      evaluate (fromString "][" :: MS.StoragePath)
        `shouldThrow` isStorableParseErr

    it "unparsePath of a leading-Index path throws StorableInternalError" $ do
      let bad = MS.fromList [MS.Index "0"]
      evaluate (MS.unparsePath bad) `shouldThrow` isStorableInternal

    it "unparsePath of a well-formed path round-trips" $ do
      let p = MS.fromList [MS.Field "foo", MS.Index "0", MS.Field "bar"]
      MS.parsePath (MS.unparsePath p) `shouldBe` Right p

  -- Audit finding 9 / 45: the public 'storageValueByteStringToBasic'
  -- entry point catches RLP-decode failures (which now manifest as a
  -- typed 'StorableException') and converts them to 'Left'. Use of
  -- 'unsafePerformIO' (instead of 'unsafeDupablePerformIO') ensures the
  -- internal 'evaluate' isn't duplicated under untrusted blockchain
  -- data.
  describe "Audit findings 9 & 45: storageValueByteStringToBasic is total" $ do
    it "well-formed RLP round-trips" $ do
      let bv = MS.BInteger 1234567890
          encoded = RLP.rlpSerialize (RLP.rlpEncode bv)
      MS.storageValueByteStringToBasic encoded `shouldBe` Right bv

    it "malformed RLP returns Left, not crash" $ do
      MS.storageValueByteStringToBasic (B.pack [0xff, 0xff, 0xff, 0xff])
        `shouldSatisfy` either (const True) (const False)

    it "RLP-shaped but invalid type tag returns Left" $ do
      -- type tag 99 doesn't match any BasicValue constructor — the
      -- unconditional fix routes this through StorableMalformedData
      -- which the wrapper catches.
      let bytes = RLP.rlpSerialize $
                    RLP.RLPArray [RLP.RLPScalar 99, RLP.rlpEncode (1 :: Integer)]
      MS.storageValueByteStringToBasic bytes
        `shouldSatisfy` either (const True) (const False)

    it "raw rlpDecode on invalid type tag throws StorableMalformedData" $ do
      -- Belt-and-braces: confirm the underlying exception is the typed
      -- variant, not a bare ErrorCall (the pre-fix behaviour).
      let rlp = RLP.RLPArray [RLP.RLPScalar 99, RLP.rlpEncode (1 :: Integer)]
      evaluate (RLP.rlpDecode rlp :: MS.BasicValue)
        `shouldThrow` isStorableMalformed

  -- Audit finding 48: 'escapeKey' / 'unescapeKey' are now annotated
  -- '{-# NOINLINE #-}' so GHC can't lift their 'unsafePerformIO' out of
  -- a calling context. We can't *test* the pragma directly — instead
  -- we re-assert the round-trip behaviour so any future rewrite that
  -- breaks NOINLINE gets caught here as well.
  describe "Audit finding 48: escape/unescape round-trips" $ do
    it "escape then unescape is identity for adversarial inputs" $ do
      let inputs =
            [ ""
            , "plain ascii"
            , "with \\ backslash"
            , "with ] bracket"
            , "with both \\ ]"
            , B.pack [0..255]
            ]
      mapM_ (\bs -> MS.unescapeKey (MS.escapeKey bs) `shouldBe` bs) inputs

  -- Audit finding 10: 'coerceType' for SDecimal previously used 'read'
  -- on the inbound string literal, crashing the VM on non-numeric
  -- input. It now uses 'readMaybe' and raises 'TypeError' which
  -- 'runSM' converts into a normal contract revert.
  describe "Audit finding 10: Decimal string coercion is total" $ do
    it "valid numeric literal coerces to SDecimal" $ do
      let v = coerceType (def :: Contract.Contract) emptyCC SVMType.Decimal (SString "1.25")
      case v of
        SDecimal _ -> pure ()
        other     -> expectationFailure $ "expected SDecimal; got " ++ show other

    it "non-numeric literal raises TypeError instead of crashing" $ do
      evaluate (coerceType (def :: Contract.Contract) emptyCC SVMType.Decimal (SString "not a number"))
        `shouldThrow` isTypeError

  -- Audit finding 46: 'coerceFromInt' for an enum used to feed the
  -- supplied integer through 'fromIntegral . (!!)' without a lower-bound
  -- check, so a negative literal indexed past the start of the enum
  -- list and crashed with an out-of-range 'Prelude.!!'. We exercise it
  -- through the exported 'coerceType' wrapper.
  describe "Audit finding 46: enum integer coercion bounds" $ do
    let ct = mkEnumContract
        cc = emptyCC
        statusType = SVMType.UnknownLabel "Status"

    it "in-range positive index produces the matching enum value" $ do
      case coerceType ct cc statusType (SInteger 1) of
        SEnumVal _ "B" 1 -> pure ()
        other            -> expectationFailure $ "expected B; got " ++ show other

    it "out-of-range positive index raises TypeError" $ do
      evaluate (coerceType ct cc statusType (SInteger 99)) `shouldThrow` isTypeError

    it "negative index raises TypeError instead of crashing on (!!)" $ do
      evaluate (coerceType ct cc statusType (SInteger (-1))) `shouldThrow` isTypeError

  -- Audit finding 41: 'valEqualsGated True' is the post-fork total
  -- equality check that returns False (rather than throw 'todo') for
  -- cross-constructor pairs. The pre-audit 'Eq' instance is preserved
  -- for Map/Set internals; only the gated path uses the total version.
  describe "Audit finding 41: valEqualsGated True is total" $ do
    let ct = def :: Contract.Contract
        cc = emptyCC
        eqStrict = valEqualsGated True ct cc

    it "matched constructors compare structurally" $ do
      eqStrict (SInteger 7) (SInteger 7) `shouldBe` True
      eqStrict (SInteger 7) (SInteger 8) `shouldBe` False

    it "mismatched constructors return False instead of throwing" $ do
      -- Use non-default values on each side: 'totalValueEq' first runs
      -- both sides through 'toNull', which collapses SBool False /
      -- SInteger 0 / SDecimal 0 / SString "" / etc to SNULL. Comparing
      -- SNULL == SNULL is intentionally True (treats "default" values
      -- as equal across types — the pre-audit Eq behaviour). The
      -- regression we care about is mismatched *non-default* pairs no
      -- longer raising.
      eqStrict (SBool True)    (SString "true") `shouldBe` False
      eqStrict (SDecimal 1.5)  (SBool True)     `shouldBe` False
      eqStrict (SBytes "abc")  (SBool True)     `shouldBe` False

  -- Audit infrastructure: the pure ForkGate predicate is the core of
  -- every gated finding. Smoke-test the network/block matrix so a
  -- silent constant change here can't accidentally turn the whole audit
  -- fork on or off network-wide.
  describe "Blockchain.VM.ForkGate predicate" $ do
    it "Helium activates at and after block 100,000" $ do
      ForkGate.isAuditForkActive ForkGate.heliumNetworkId  99999 `shouldBe` False
      ForkGate.isAuditForkActive ForkGate.heliumNetworkId 100000 `shouldBe` True
      ForkGate.isAuditForkActive ForkGate.heliumNetworkId 999999 `shouldBe` True

    it "Upquark activates at and after block 100,000" $ do
      ForkGate.isAuditForkActive ForkGate.upquarkNetworkId  99999 `shouldBe` False
      ForkGate.isAuditForkActive ForkGate.upquarkNetworkId 100000 `shouldBe` True

    it "an unknown network never activates" $ do
      ForkGate.isAuditForkActive 1                                 0 `shouldBe` False
      ForkGate.isAuditForkActive 1                       1000000000 `shouldBe` False
      ForkGate.isAuditForkActive 1234567890123456789          100000 `shouldBe` False

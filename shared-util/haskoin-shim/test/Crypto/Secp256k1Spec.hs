{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
{-# OPTIONS_GHC -fno-warn-unused-imports #-}
module Crypto.Secp256k1Spec (spec) where

import           Crypto.HaskoinShim
import Data.Coerce
import Data.Maybe (fromMaybe)
import           Test.Hspec
import           Test.QuickCheck         (Property, property, (==>))
import qualified Network.Haskoin.Internals as HK (makePubKeyU, makePoint)

import Debug.Trace

spec :: Spec
spec = do
    describe "signatures" $ do
        it "recovers key from signed message" $ property $ signRecMsgTest
        it "detects bad recoverable signature" $ property $ badRecSignatureTest
        it "recovers public keys" $ property $ recoverTest
        it "Bad recover public keys" $ property $ badRecoverTest
    describe "serialization" $ do
        it "serializes public key" $ property $ serializePubKeyTest
        it "serializes compact recoverable signature" $
            property $ serializeCompactRecSigTest
        it "serialize secret key" $ property $ serializeSecKeyTest

signRecMsgTest :: (Msg, SecKey) -> Bool
signRecMsgTest (fm, fk) = verifySig fp fg fm where
    fp = derivePubKey fk
    fg = convertRecSig $ signRecMsg fk fm

recoverTest :: (Msg, SecKey) -> Expectation
recoverTest (fm, fk) = recover fg fm `shouldBe` Just fp where
    fp = derivePubKey fk
    fg = signRecMsg fk fm

badRecoverTest :: (Msg, SecKey, Msg) -> Property
badRecoverTest (fm, fk, fm') =
  fm' /= fm ==> fp' /= Nothing ==> fp' /= Just fp
  where
    fg  = signRecMsg fk fm
    fp  = derivePubKey fk
    fp' = recover fg fm'

badRecSignatureTest :: (Msg, SecKey, PubKey) -> Bool
badRecSignatureTest (fm, fk, fp) = not $ verifySig fp fg fm where
    fg = convertRecSig $ signRecMsg fk fm

serializePubKeyTest :: (PubKey, Bool) -> Expectation
serializePubKeyTest (fp, b) =
    importPubKey (exportPubKey b fp) `shouldBe` Just (changeCompression b fp)

serializeCompactRecSigTest :: (Msg, SecKey) -> Bool
serializeCompactRecSigTest (fm, fk) =
    case importCompactRecSig $ exportCompactRecSig fg of
        Just fg' -> fg == fg'
        Nothing  -> False
  where
    fg = signRecMsg fk fm

serializeSecKeyTest :: SecKey -> Bool
serializeSecKeyTest fk =
    case secKey $ getSecKey fk of
        Just fk' -> fk == fk'
        Nothing  -> False


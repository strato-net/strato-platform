{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Main where

import qualified Blockchain.Data.AlternateTransaction as E
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Secp256k1
import Clockwork
import Crypto.Random.Entropy
import qualified Crypto.Secp256k1 as SEC
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as C8
import Data.Maybe
import qualified LabeledError
import System.IO.Unsafe
import Test.Hspec

-- some dummy test values
testPriv :: B.ByteString
testPriv = LabeledError.b16Decode "testPriv" $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"

ent :: B.ByteString
ent = unsafePerformIO $ getEntropy 32

newPriv :: SEC.SecKey
newPriv = fromMaybe (error "couldn't get secp-haskell key") (SEC.secKey ent)

main :: IO ()
main = do
  hspec secp256k1_haskell_spec
  timingTests

-- TODO: maybe this should be somewhere else, like in strato-model
secp256k1_haskell_spec :: Spec
secp256k1_haskell_spec =
  describe "secp256k1-haskell can do crypto operations just like haskoin" $ do
    it "verify signatures" $ do
      let mesg = E.rlpHash ("STRATO is a permissioned blockchain" :: String)
          newMsg = fromMaybe (error "couldn't get new messsage") (SEC.msg mesg)
          newSig = SEC.signRecMsg newPriv newMsg

          newValid = SEC.verifySig (SEC.derivePubKey newPriv) (SEC.convertRecSig newSig) newMsg
      newValid `shouldBe` True

-- be warned, ye who enter here: you must time your pure functions the way it's done below
-- (with strict !let bindings in the cwPrintTime block), otherwise the value is thunked
-- and evaluated later (outside the cwPrintTIme block), or discarded entirely (if you wildcard it)
timingTests :: IO ()
timingTests = do
  e <- getEntropy 32

  putStrLn "\nLET'S TIME IT! comparing secp256k1-haskell and haskoin for all things EC"

  putStrLn "\nPrivate Key import (from the same pre-pulled entropy):"
  putStrLn "secp256k1-haskell: "
  _ <- cwPrintTime $ do
    let !pk = SEC.secKey e
    return pk

  putStrLn "\nPublic Key derivation:"
  putStrLn "secp256k1-haskell: "
  _ <- cwPrintTime $ do
    let !pub = SEC.derivePubKey newPriv
    return pub

  putStrLn "\nAddress derivation:"
  putStrLn "secp256k1-haskell: "
  _ <- cwPrintTime $ do
    let !addr = fromPrivateKey (PrivateKey newPriv)
    return addr

  -- message hashes for signatures
  let mesg = E.rlpHash ("A monad is like a burrito, or so the Glaswegians would have us believe" :: String)
      sMesg = fromMaybe (error "couldnt get secp256k1 message hash") (SEC.msg mesg)

  putStrLn "\nECDSA Signatures:"
  putStrLn "secp256k1-haskell: "
  _ <- cwPrintTime $ do
    let !sig = SEC.signRecMsg newPriv sMesg
    return sig

  -- signatures to use for recovery
  let sSig = SEC.signRecMsg newPriv sMesg

  putStrLn "\nPublic Key Signature Recovery:"
  putStrLn "secp256k1-haskell"
  _ <- cwPrintTime $ do
    let !pub = fromMaybe (error "couldnt recover secp256k1 pubkey") (SEC.recover sSig sMesg)
    return pub

  putStrLn "\nSignature Verification:"
  putStrLn "secp256k1-haskell:"
  _ <- cwPrintTime $ do
    let !bl = SEC.verifySig (SEC.derivePubKey newPriv) (SEC.convertRecSig sSig) sMesg
    return bl

  putStrLn "\nDone"

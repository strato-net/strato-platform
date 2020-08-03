{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Main where

import           Test.Hspec


import qualified Data.ByteString                as B
import qualified Data.ByteString.Base16         as B16
import qualified Data.ByteString.Char8          as C8
import qualified Data.ByteString.Short          as Sh

import           Crypto.Random.Entropy
import qualified Network.Haskoin.Internals         as HKI
import qualified Crypto.HaskoinShim             as HK
import qualified Crypto.Secp256k1               as SEC
import           Strato.Strato23.Crypto         

import           Data.Maybe
import           Data.Coerce
import           System.IO.Unsafe

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Secp256k1
import qualified BlockApps.Ethereum                    as E
import           Clockwork


-- some dummy test values
testPriv :: B.ByteString
testPriv = fst $ B16.decode $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866"

ent :: B.ByteString
ent = unsafePerformIO $ getEntropy 32

oldPriv :: HK.SecKey
oldPriv = fromMaybe (error "couldn't get haskoin key") (HK.secKey ent)

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
    it "create secp256k1 private keys" $ do
      let oldEnc = B16.encode $ HKI.encodePrvKey $ coerce oldPriv
      show oldEnc `shouldBe` show newPriv -- the newPriv show instance does base 16 encoding
    it "create secp256k1 public keys" $ do
      let oldPubBS = HK.exportPubKey False $ HK.derivePubKey oldPriv
          newPubBS = SEC.exportPubKey False $ SEC.derivePubKey newPriv
      oldPubBS `shouldBe` newPubBS 
    it "create Ethereum addresses" $ do
      let oldAddy = E.deriveAddress $ HK.derivePubKey oldPriv
          newAddy = fromPrivateKey (PrivateKey newPriv)
      oldAddy `shouldBe` newAddy
    
    it "create secp256k1 private keys from test key value" $ do
      let testOldPriv = fromMaybe (error "couldn't get test haskoin key") (HK.secKey testPriv)
          testNewPriv = fromMaybe (error "couldn't get test secp key") (SEC.secKey testPriv)
          testOldEnc = B16.encode $ HKI.encodePrvKey $ coerce testOldPriv
      show testOldEnc `shouldBe` show testNewPriv
    it "create secp256k1 public keys from test key value" $ do
      let testOldPriv = fromMaybe (error "couldn't get test haskoin key") (HK.secKey testPriv)
          testNewPriv = fromMaybe (error "couldn't get test secp key") (SEC.secKey testPriv)
          testOldPubBS = HK.exportPubKey False $ HK.derivePubKey testOldPriv
          testNewPubBS = SEC.exportPubKey False $ SEC.derivePubKey testNewPriv
      testOldPubBS `shouldBe` testNewPubBS
    it "create Ethereum addresses from test key value" $ do
      let testOldPriv = fromMaybe (error "couldn't get test haskoin key") (HK.secKey testPriv)
          testNewPriv = fromMaybe (error "couldn't get test secp key") (SEC.secKey testPriv)
          oldAddy = E.deriveAddress $ HK.derivePubKey testOldPriv
          newAddy = fromPrivateKey (PrivateKey testNewPriv)
      oldAddy `shouldBe` newAddy
   

   -- for some reason R and S values are swapped in secp256k1-haskell
    it "sign things" $ do
      let mesg = E.rlpHash ("STRATO is a permissioned blockchain" :: String)
          oldMsg = fromMaybe (error "couldn't get old message") (HK.msg $ bytesToWord256 mesg)
          newMsg = fromMaybe (error "couldn't get new messsage") (SEC.msg mesg)
          oldSig = HK.exportCompactRecSig $ HK.signRecMsg oldPriv oldMsg
          newSig = SEC.exportCompactRecSig $ SEC.signRecMsg newPriv newMsg
          oldSigVals = [ HKI.getBigWordInteger $ HK.getCompactRecSigR oldSig
                       , HKI.getBigWordInteger $ HK.getCompactRecSigS oldSig
                       , toInteger $ HK.getCompactRecSigV oldSig
                       ]
          newSigVals = [ HKI.getBigWordInteger $ bytesToWord256 $ Sh.fromShort $ SEC.getCompactRecSigS newSig
                       , HKI.getBigWordInteger $ bytesToWord256 $ Sh.fromShort $ SEC.getCompactRecSigR newSig
                       , toInteger $ SEC.getCompactRecSigV newSig
                       ]
      oldSigVals `shouldBe` newSigVals
    
    it "recover signatures" $ do
      let mesg = E.rlpHash ("STRATO is a permissioned blockchain" :: String)
          oldMsg = fromMaybe (error "couldn't get old message") (HK.msg $ bytesToWord256 mesg)
          newMsg = fromMaybe (error "couldn't get new messsage") (SEC.msg mesg)
          oldSig = HK.signRecMsg oldPriv oldMsg
          newSig = SEC.signRecMsg newPriv newMsg
          oldRecPK = fromMaybe (error "couldn't recover haskoin pubkey") (HK.recover oldSig oldMsg)
          newRecPK = fromMaybe (error "couldnt recover secp256k1 pubkey") (SEC.recover newSig newMsg)
      (HK.exportPubKey False oldRecPK) `shouldBe` (SEC.exportPubKey False newRecPK)

    it "verify signatures" $ do
      let mesg = E.rlpHash ("STRATO is a permissioned blockchain" :: String)
          oldMsg = fromMaybe (error "couldn't get old message") (HK.msg $ bytesToWord256 mesg)
          newMsg = fromMaybe (error "couldn't get new messsage") (SEC.msg mesg)
          oldSig = HK.signRecMsg oldPriv oldMsg
          newSig = SEC.signRecMsg newPriv newMsg

          oldValid = HK.verifySig (HK.derivePubKey oldPriv) (HK.convertRecSig oldSig) oldMsg
          newValid = SEC.verifySig (SEC.derivePubKey newPriv) (SEC.convertRecSig newSig) newMsg
      [oldValid, newValid] `shouldBe` [True, True]



timingTests :: IO ()
timingTests = do

  putStrLn "\nLET'S TIME IT! comparing secp256k1-haskell and haskoin for all things EC"
  
  putStrLn "\nPrivate Key Creation:"
  putStrLn "Haskoin: "
  _ <- cwPrintTime $ return $ HK.secKey ent
  putStrLn "secp256k1-haskell: "
  _ <- cwPrintTime $ return $ SEC.secKey ent
 

  putStrLn "\nPublic Key Creation:"
  putStrLn "Haskoin: "
  _ <- cwPrintTime $ return $ HK.exportPubKey False $ HK.derivePubKey oldPriv
  putStrLn "secp256k1-haskell: "
  _ <- cwPrintTime $ return $ SEC.exportPubKey False $ SEC.derivePubKey newPriv

  
  putStrLn "\nAddress derivation:"
  putStrLn "Haskoin: "
  _ <- cwPrintTime $ return $ E.deriveAddress $ HK.derivePubKey oldPriv
  putStrLn "secp256k1-haskell: "
  _ <- cwPrintTime $ return $ fromPrivateKey (PrivateKey newPriv)


  -- message hashes for signatures
  let mesg = E.rlpHash ("A monad is like a burrito, or so the Glaswegians would have us believe" :: String)
      hMesg = fromMaybe (error "couldn't get haskoin message hash") (HK.msg $ bytesToWord256 mesg)
      sMesg = fromMaybe (error "couldnt get secp256k1 message hash") (SEC.msg mesg)
  
  putStrLn "\nECDSA Signatures:"
  putStrLn "Haskoin: "
  _ <- cwPrintTime $ return $ HK.signRecMsg oldPriv hMesg
  putStrLn "secp256k1-haskell: "
  _ <- cwPrintTime $ return $ SEC.signRecMsg newPriv sMesg


  -- signatures to use for recovery
  let hSig = HK.signRecMsg oldPriv hMesg
      sSig = SEC.signRecMsg newPriv sMesg

  putStrLn "\nPublic Key Signature Recovery:"
  putStrLn "Haskoin:"
  _ <- cwPrintTime $ return $ fromMaybe (error "couldn't recover haskoin pubkey") (HK.recover hSig hMesg)
  putStrLn "secp256k1-haskell"
  _ <- cwPrintTime $ return $ fromMaybe (error "couldnt recover secp256k1 pubkey") (SEC.recover sSig sMesg)

          
  putStrLn "\nSignature Verification:"
  putStrLn "Haskoin:"
  _ <- cwPrintTime $ return $ HK.verifySig (HK.derivePubKey oldPriv) (HK.convertRecSig hSig) hMesg
  putStrLn "secp256k1-haskell:"
  _ <- cwPrintTime $ return $ SEC.verifySig (SEC.derivePubKey newPriv) (SEC.convertRecSig sSig) sMesg
 

  putStrLn "\n\n\nOther Timing Tests:"
  putStrLn "\nKeyStore creation (with encryption):" 
  KeyStore{..} <- cwPrintTime $ newKeyStore $ textPassword "1234"
  
  putStrLn "\nDecryption:"
  _ <- cwPrintTime $ return $ decryptSecKey (textPassword "1234") keystoreSalt keystoreAcctNonce keystoreAcctEncSecKey



  putStrLn "\nDone"

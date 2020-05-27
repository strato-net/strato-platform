{-# LANGUAGE OverloadedStrings #-}

module Main where

import           Test.Hspec


import qualified Data.ByteString                as B
import qualified Data.ByteString.Base16         as B16
import qualified Data.ByteString.Char8          as C8
import qualified Data.ByteString.Short          as Sh

import           Crypto.Random.Entropy
import qualified Network.Haskoin.Internals         as HKI
import qualified Strato.Strato23.Crypto         as VWC
import qualified Crypto.HaskoinShim             as HK
import qualified Crypto.Secp256k1               as SEC


import           Data.Maybe
import           Data.Coerce
import           System.IO.Unsafe

import           Blockchain.Strato.Model.ExtendedWord
import qualified BlockApps.Ethereum                    as E



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
main = hspec secp256k1_haskell_spec

secp256k1_haskell_spec :: Spec
secp256k1_haskell_spec = 
  describe "Vault Wrapper Utils Spec" $ do
    it "create secp256k1 private keys" $ do
      let oldEnc = B16.encode $ HKI.encodePrvKey $ coerce oldPriv
      show oldEnc `shouldBe` show newPriv
    it "create secp256k1 public keys" $ do
      let oldPubBS = HK.exportPubKey False $ HK.derivePubKey oldPriv
          newPubBS = SEC.exportPubKey False $ SEC.derivePubKey newPriv
      oldPubBS `shouldBe` newPubBS 
    it "create Ethereum addresses" $ do
      let oldAddy = E.deriveAddress $ HK.derivePubKey oldPriv
          newAddy = VWC.deriveAddress newPriv
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
          newAddy = VWC.deriveAddress testNewPriv
      oldAddy `shouldBe` newAddy
   

   -- for some reason R and S values are swapped in secp256k1-haskell
    it "get signatures" $ do
      let mesg = E.rlpHash ("doodoodaadaa" :: String)
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

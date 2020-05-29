{-# LANGUAGE OverloadedStrings #-}

module Main where



import           Test.Hspec

import qualified Data.ByteString.Base16                as B16
import qualified Data.ByteString.Char8                 as C8

import           Data.Maybe

--import           Clockwork


import           Blockchain.Strato.Model.ExtendedWord
import qualified Blockchain.ExtendedECDSA              as HEC
import qualified Blockchain.FastECRecover              as FEC
import qualified Blockchain.Strato.Model.Keccak256     as SHA

import qualified Network.Haskoin.Crypto         as HKI



mesg :: Word256
mesg = SHA.keccak256ToWord256 $ SHA.hash $ C8.pack "hey what is going on"

testPriv :: HKI.PrvKey
testPriv = do 
  let mpk = HKI.decodePrvKey HKI.makePrvKey (fst $ B16.decode $ C8.pack $ "09e910621c2e988e9f7f6ffcd7024f54ec1461fa6e86a4b545e9e1fe21c28866")
  fromMaybe (error "couldn't get haskoin key") mpk


main :: IO ()
main = do
  putStrLn $ "pub is " ++ (show $ HKI.derivePubKey testPriv) 
  hspec $ fast_ecrecover_spec 


fast_ecrecover_spec :: Spec
fast_ecrecover_spec = 
  describe "fast-ecrecover (using libsecp256k1) versus haskoin for signature recovery" $ do
    it "public key recovery" $ do
      let sig = HEC.detExtSignMsg mesg testPriv
          hpk = fromMaybe (error "could not recover pubkey using extECDSA") (HEC.getPubKeyFromSignature sig mesg)
          fpk = fromMaybe (error "could not recover pubkey using fastECDSA") (FEC.getPubKeyFromSignature_libsecp256k1 sig mesg)
      hpk `shouldBe` fpk



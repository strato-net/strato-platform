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
    
    it "recover signatures" $ do
      let mesg = E.rlpHash ("doodoodaadaa" :: String)
          oldMsg = fromMaybe (error "couldn't get old message") (HK.msg $ bytesToWord256 mesg)
          newMsg = fromMaybe (error "couldn't get new messsage") (SEC.msg mesg)
          oldSig = HK.signRecMsg oldPriv oldMsg
          newSig = SEC.signRecMsg newPriv newMsg
          oldRecPK = fromMaybe (error "couldn't recover haskoin pubkey") (HK.recover oldSig oldMsg)
          newRecPK = fromMaybe (error "couldnt recover secp256k1 pubkey") (SEC.recover newSig newMsg)
      (HK.exportPubKey False oldRecPK) `shouldBe` (SEC.exportPubKey False newRecPK)

    it "compare slow and fast signature recovery" $ do
      let mesg = E.rlpHash ("look! I'm helping!" :: String)
          recMsg = fromMaybe (error "couldn't get old message") (HK.msg $ bytesToWord256 mesg)
          recSig = HK.signRecMsg oldPriv recMsg
          slowPub = fromMaybe (error "couldn't recover slow") (HK.recover recSig recMsg)
          fastPub = fromMaybe (error "couldn't recover fast") (HK.recover_fast recSig recMsg)
      slowPub `shouldBe` fastPub
        


timingTests :: IO ()
timingTests = do
  

  putStrLn "TIME IT! comparing secp256k1-haskell and haskoin for all things EC"
  
  putStrLn "\nPrivate Key Creation:"
  putStrLn "Haskoin: "
  cwPrintTime $ do
    let _ = HK.secKey ent
    return ()
  
  putStrLn "secp256k1-haskell: "
  cwPrintTime $ do
    let _ = SEC.secKey ent
    return ()
  
  
  putStrLn "\nPublic Key Creation:"
  putStrLn "Haskoin: "
  cwPrintTime $ do
    let _ = HK.exportPubKey False $ HK.derivePubKey oldPriv
    return ()

  putStrLn "secp256k1-haskell: "
  cwPrintTime $ do
    let _ = SEC.exportPubKey False $ SEC.derivePubKey newPriv
    return ()

  
  putStrLn "\nAddress derivation:"
  putStrLn "Haskoin: "
  cwPrintTime $ do
    let _ = E.deriveAddress $ HK.derivePubKey oldPriv
    return ()

  putStrLn "secp256k1-haskell: "
  cwPrintTime $ do
    let _ = VWC.deriveAddress newPriv
    return ()


  let mesg = E.rlpHash ("doodoodaadaa yo yo yo" :: String)
  putStrLn "\nECDSA Signatures:"
  putStrLn "Haskoin: "
  _ <- cwPrintTime $ do
    let hMesg = fromMaybe (error "couldn't get old message") (HK.msg $ bytesToWord256 mesg)
    return $ HK.signRecMsg oldPriv hMesg

  putStrLn "secp256k1-haskell: "
  _ <- cwPrintTime $ do
    let sMesg = fromMaybe (error "couldnt get new message") (SEC.msg mesg)
    return $ SEC.signRecMsg newPriv sMesg

  let recMsg = fromMaybe (error "couldn't get old message") (HK.msg $ bytesToWord256 mesg)
      recSig = HK.signRecMsg oldPriv recMsg
  
  putStrLn "\nSignature Recovery:"
  putStrLn "Haskoin: (the ExtendedECDSA way)"
  mHpk <- cwPrintTime $ return $ HK.recover recSig recMsg

  putStrLn "fast-ecrecover: "
  mFpk <- (cwPrintTime $ return $ HK.recover_fast recSig recMsg)

  -- fail if these temp sig types aren't right
  let hpk = fromMaybe (error "haskoin signature recovery failed") mHpk
      fpk = fromMaybe (error "secp256k1 signature recovery failed") mFpk
      hbs = C8.unpack $ B16.encode $ HK.exportPubKey False hpk
      fbs = C8.unpack $ B16.encode $ HK.exportPubKey False fpk
  putStrLn "the two:"
  putStrLn hbs
  putStrLn fbs
  putStrLn "the original:"
  putStrLn $ C8.unpack $ B16.encode $ HK.exportPubKey False $ HK.derivePubKey oldPriv
  if (hpk == fpk) then 
    putStrLn "\ndone"
  else 
    error "slow and fast recoveries don't recover the same public key"

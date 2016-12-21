{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Handshake (
  AckMessage(..),
  getHandshakeBytes,
  bytesToAckMsg
  ) where

import qualified Crypto.Hash.SHA3 as SHA3
import Crypto.PubKey.ECC.DH
import Crypto.Types.PubKey.ECC
import Data.Binary
import Data.Binary.Get
import Data.Binary.Put
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Maybe
import qualified Network.Haskoin.Internals as H

import Blockchain.Data.PubKey
import Blockchain.ExtendedECDSA
import Blockchain.ExtWord
import qualified Blockchain.ECIES as ECIES


-- import Debug.Trace

theCurve::Curve
theCurve = getCurveByName SEC_p256k1

sigToBytes::ExtendedSignature->[Word8]
sigToBytes (ExtendedSignature signature yIsOdd) =
  word256ToBytes (fromIntegral $ H.sigR signature) ++
  word256ToBytes (fromIntegral $ H.sigS signature) ++
  [if yIsOdd then 1 else 0]


data AckMessage =
  AckMessage {
    ackEphemeralPubKey::Point,
    ackNonce::Word256,
    ackKnownPeer::Bool
    } deriving (Show)


knownPeer :: Word8 -> Bool
knownPeer b =
  case b of
    0 -> False
    1 -> True
    _ -> error "byte is neither 0 nor 1"

boolToWord8 :: Bool -> Word8
boolToWord8 True = 1
boolToWord8 False = 0

errorHead::String->[a]->a
errorHead _ (x:_) = x
errorHead msg _ = error msg

instance Binary AckMessage where
  get = do
    point <- fmap (bytesToPoint . B.unpack) $ getByteString 64
    nonce <- fmap (bytesToWord256 . B.unpack) $ getByteString 32                   
    kp <- fmap (knownPeer . errorHead "head error in instance Binary AckMessage" . B.unpack) $ getByteString 1
    return $ (AckMessage point nonce kp)
    
  put (AckMessage point nonce kp) = do
    putByteString $ (B.pack . pointToBytes) $ point
    putByteString (B.pack . word256ToBytes $ nonce)
    putByteString (B.pack $ [(boolToWord8 kp)])
    
bytesToAckMsg::[Word8]->AckMessage
bytesToAckMsg bytes | length bytes == 97 =
  AckMessage {
    ackEphemeralPubKey=bytesToPoint $ take 64 bytes,
    ackNonce=bytesToWord256 $ take 32 $ drop 64 bytes,
    ackKnownPeer=
      case bytes !! 96 of
        0 -> False
        1 -> True
        _ -> error "known peer byte in ackMessage is neither 0 nor 1"
    }
bytesToAckMsg _ = error "wrong number of bytes in call to bytesToECIESMsg"

getHandshakeBytes::PrivateNumber->PublicPoint->B.ByteString->IO B.ByteString
getHandshakeBytes myPriv otherPubKey myNonce = do
  let
    myPublic = calculatePublic theCurve myPriv
    SharedKey sharedKey = getShared theCurve myPriv otherPubKey
   
    msg = fromIntegral sharedKey `xor` (bytesToWord256 $ B.unpack myNonce)


 --  putStrLn $ "sharedKey: " ++ show sharedKey
  -- putStrLn $ "msg:       " ++ show msg
  sig <- H.withSource H.devURandom $ extSignMsg msg (fromMaybe (error "invalid private number in call to getHandshakeBytes") $ H.makePrvKey $ fromIntegral myPriv)
  let
    ephemeral =
      fromMaybe (error "malformed signature given to call getHandshakeBytes") $
      getPubKeyFromSignature sig msg  
    hepubk = SHA3.hash 256 $ B.pack $ pubKeyToBytes ephemeral
    pubk = B.pack $ pointToBytes myPublic
    theData = B.pack (sigToBytes sig) `B.append`
                hepubk `B.append`
                pubk `B.append`
                myNonce `B.append`
                B.singleton 0
  -- putStrLn $ "ephemeral: " ++ show ephemeral
  -- putStrLn $ "hepubk: " ++ show hepubk
  -- putStrLn $ "pubk: " ++ show pubk
  -- putStrLn $ "theData: " ++ show theData

  eciesMsgBytes <- fmap BL.toStrict $ ECIES.encrypt myPriv otherPubKey theData B.empty
  
  -- putStrLn $ "eciesMsg: "
  -- putStrLn $ show eciesMsg

  -- putStrLn $ "length ciphertext: " ++ (show . B.length $ eciesCipher eciesMsg)
  -- putStrLn $ "length of wire message: " ++ (show . B.length $ eciesMsgBytes)
  
  return $ eciesMsgBytes



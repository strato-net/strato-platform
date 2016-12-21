{-# LANGUAGE OverloadedStrings #-}

module Blockchain.RLPx (
  ethCryptConnect,
  ethCryptAccept
  ) where

import Control.Exception
import Control.Monad
import Control.Monad.IO.Class
import Crypto.Cipher.AES
import qualified Crypto.Hash.SHA3 as SHA3
import Crypto.PubKey.ECC.DH
import Crypto.Random
import Crypto.Types.PubKey.ECC
import Data.Binary
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Conduit
import qualified Data.Conduit.Binary as CB
import Data.Maybe
import qualified Network.Haskoin.Internals as H

import qualified Blockchain.AESCTR as AES
import Blockchain.Data.PubKey
import Blockchain.Data.RLP
import qualified Blockchain.ECIES as ECIES
import Blockchain.Error
import Blockchain.EthEncryptionException
import Blockchain.ExtendedECDSA
import Blockchain.ExtWord
import Blockchain.Frame
import Blockchain.Handshake




--import Debug.Trace

theCurve::Curve
theCurve = getCurveByName SEC_p256k1

intToBytes::Integer->[Word8]
intToBytes x = map (fromIntegral . (x `shiftR`)) [256-8, 256-16..0]

bXor::B.ByteString->B.ByteString->B.ByteString
bXor x y | B.length x == B.length y = B.pack $ B.zipWith xor x y
bXor _ _ = error' "bXor called with two ByteStrings of different length"

ethCryptConnect::MonadIO m=>PrivateNumber->PublicPoint->ConduitM B.ByteString B.ByteString m (EthCryptState, EthCryptState)
ethCryptConnect myPriv otherPubKey = do
  --h <- liftIO $ connectTo ipAddress (PortNumber thePort)

--  liftIO $ putStrLn $ "connected over tcp"
  
  let myNonce = B.pack $ word256ToBytes 20 --TODO- Important!  Don't hardcode this

  handshakeInitBytes <- liftIO $ getHandshakeBytes myPriv otherPubKey myNonce
      
  yield handshakeInitBytes

  handshakeReplyBytes <- CB.take 210

  when (BL.length handshakeReplyBytes /= 210) $ liftIO $ throwIO $ HandshakeException "handshake reply didn't contain enough bytes"
  
  let ackMsg = bytesToAckMsg $ B.unpack $ either (error . ("error in ethCryptConnect"++)) id $ ECIES.decrypt myPriv handshakeReplyBytes B.empty

--  liftIO $ putStrLn $ "ackMsg: " ++ show ackMsg
------------------------------

  let m_originated=False -- hardcoded for now, I can only connect as client
      
      otherNonce=B.pack $ word256ToBytes $ ackNonce ackMsg

      SharedKey shared' = getShared theCurve myPriv (ackEphemeralPubKey ackMsg)
      shared = B.pack $ intToBytes shared'

      frameDecKey = myNonce `add` otherNonce `add` shared `add` shared
      macEncKey = frameDecKey `add` shared

      ingressCipher = if m_originated then handshakeInitBytes else BL.toStrict handshakeReplyBytes
      egressCipher = if m_originated then BL.toStrict handshakeReplyBytes else handshakeInitBytes

  -- liftIO $ putStrLn $ "myNonce `add` otherNonce: " ++ show (myNonce `add` otherNonce)
  -- liftIO $ putStrLn $ "myNonce `add` otherNonce `add` shared: " ++ show (myNonce `add` otherNonce `add` shared)
  
  -- liftIO $ putStrLn $ "otherNonce: " ++ show otherNonce

  -- liftIO $ putStrLn $ "frameDecKey: " ++ show frameDecKey

  -- liftIO $ putStrLn $ "shared: " ++ show shared'

  -- liftIO $ putStrLn $ "ingressCipher: " ++ show ingressCipher
  -- liftIO $ putStrLn $ "egressCipher: " ++ show egressCipher

  -- liftIO $ putStrLn $ "macEncKey: " ++ show macEncKey


  return (
          EthCryptState { --encrypt
                          aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
                          mac=SHA3.update (SHA3.init 256) $ (macEncKey `bXor` otherNonce) `B.append` egressCipher,
                          key=macEncKey
          },
          EthCryptState { --decrypt
                          aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
                          mac=SHA3.update (SHA3.init 256) $ (macEncKey `bXor` myNonce) `B.append` ingressCipher,
                          key=macEncKey
          }
         )

add::B.ByteString->B.ByteString->B.ByteString
add acc val | B.length acc ==32 && B.length val == 32 = SHA3.hash 256 $ val `B.append` acc
add _ _ = error "add called with ByteString of length not 32"

hPubKeyToPubKey::H.PubKey->Point
hPubKeyToPubKey pubKey =
  Point (fromIntegral x) (fromIntegral y)
  where
    x = fromMaybe (error "getX failed in prvKey2Address") $ H.getX hPoint
    y = fromMaybe (error "getY failed in prvKey2Address") $ H.getY hPoint
    hPoint = H.pubKeyPoint pubKey



ethCryptAccept::MonadIO m=>PrivateNumber->Point->ConduitM B.ByteString B.ByteString m (EthCryptState, EthCryptState)
ethCryptAccept myPriv otherPoint = do
  hsBytes <- CB.take 307

  maybeResult <-
    case ECIES.decrypt myPriv hsBytes B.empty of
     Left _ -> return Nothing
     Right x -> ethCryptAcceptOld myPriv otherPoint hsBytes x

  case maybeResult of
   Just x -> return x
   Nothing -> do
     let (first:second:_) = BL.unpack hsBytes
         fullSize = fromIntegral first*256 + fromIntegral second
         remainingSize = fullSize - 307 + 2
     remainingBytes <- CB.take remainingSize
     let fullBuffer = BL.drop 2 $ hsBytes `BL.append` remainingBytes
         maybeEciesMsgIBytes = ECIES.decrypt myPriv fullBuffer $ BL.toStrict $ BL.take 2 $ hsBytes `BL.append` remainingBytes
         eciesMsgIBytes = either (error . (++ ": " ++ show (BL.unpack fullBuffer)) . ("Malformed packed sent from peer: " ++)) id maybeEciesMsgIBytes
     ethCryptAcceptEIP8 myPriv otherPoint (hsBytes `BL.append` remainingBytes) eciesMsgIBytes



ethCryptAcceptEIP8::MonadIO m=>
                    PrivateNumber->Point->BL.ByteString->B.ByteString->ConduitM B.ByteString B.ByteString m (EthCryptState, EthCryptState)
ethCryptAcceptEIP8 myPriv _ hsBytes eciesMsgIBytes = do

  let (RLPArray [signatureRLP, pubKeyRLP, otherNonceRLP, versionRLP], _) = rlpSplit eciesMsgIBytes
      otherNonce = rlpDecode otherNonceRLP
      pubKey = rlpDecode pubKeyRLP::B.ByteString
      signatureBytes = rlpDecode signatureRLP
      version = rlpDecode versionRLP::Integer
                                                                           
  --liftIO $ putStrLn $ "signature: " ++ show signatureBytes
  --liftIO $ putStrLn $ "pubKey: " ++ show pubKey
  --liftIO $ putStrLn $ "otherNonce: " ++ show otherNonce
  --liftIO $ putStrLn $ "version: " ++ show version

  let otherPoint = bytesToPoint $ B.unpack pubKey
             
  when (version /= 4) $ error "wrong version in packet sent to ethCryptAcceptEIP8"
       
  let SharedKey sharedKey = getShared theCurve myPriv otherPoint
      msg = fromIntegral sharedKey `xor` (bytesToWord256 $ B.unpack otherNonce)
      r = bytesToWord256 $ B.unpack $ B.take 32 $ signatureBytes
      s = bytesToWord256 $ B.unpack $ B.take 32 $ B.drop 32 $ signatureBytes
      v = head . B.unpack $ B.take 1 $ B.drop 64 signatureBytes
      yIsOdd = v == 1

      extSig = ExtendedSignature (H.Signature (fromIntegral r) (fromIntegral s)) yIsOdd
      otherEphemeral = hPubKeyToPubKey $
                            fromMaybe (error "malformed signature in tcpHandshakeServer") $
                            getPubKeyFromSignature extSig msg

  entropyPool <- liftIO createEntropyPool
  let g = cprgCreate entropyPool :: SystemRNG
      (myPriv', _) = generatePrivate g $ getCurveByName SEC_p256k1
      myEphemeral = calculatePublic theCurve myPriv'
      myNonce = 25 :: Word256
      ackMsg = AckMessage { ackEphemeralPubKey=myEphemeral, ackNonce=myNonce, ackKnownPeer=False }
        
  eciesMsgOBytes <- liftIO $ fmap BL.toStrict $ ECIES.encrypt myPriv' otherPoint (BL.toStrict $ encode $ ackMsg) B.empty

  yield $ eciesMsgOBytes

  let SharedKey ephemeralSharedSecret = getShared theCurve myPriv' otherEphemeral
      ephemeralSharedSecretBytes = intToBytes ephemeralSharedSecret

      myNonceBS = B.pack $ word256ToBytes myNonce
      frameDecKey = otherNonce `add`
                        myNonceBS `add`
                        (B.pack ephemeralSharedSecretBytes) `add`
                        (B.pack ephemeralSharedSecretBytes)
      macEncKey = frameDecKey `add` (B.pack ephemeralSharedSecretBytes)

  return (
      EthCryptState { --encrypt
         aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
         mac=SHA3.update (SHA3.init 256) $ (macEncKey `bXor` otherNonce) `B.append` eciesMsgOBytes,
         key=macEncKey
         },
      EthCryptState { --decrypt
        aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
        mac=SHA3.update (SHA3.init 256) $ (macEncKey `bXor` myNonceBS) `B.append` (BL.toStrict hsBytes),
        key=macEncKey
        }
      )







ethCryptAcceptOld::MonadIO m=>PrivateNumber->Point->BL.ByteString->B.ByteString->ConduitM B.ByteString B.ByteString m (Maybe (EthCryptState, EthCryptState))
ethCryptAcceptOld myPriv otherPoint hsBytes eciesMsgIBytes = do

    let SharedKey sharedKey = getShared theCurve myPriv otherPoint
        otherNonce = B.take 32 $ B.drop 161 $ eciesMsgIBytes
        msg = fromIntegral sharedKey `xor` (bytesToWord256 $ B.unpack otherNonce)
        r = bytesToWord256 $ B.unpack $ B.take 32 $ eciesMsgIBytes
        s = bytesToWord256 $ B.unpack $ B.take 32 $ B.drop 32 $ eciesMsgIBytes
        v = head . B.unpack $ B.take 1 $ B.drop 64 eciesMsgIBytes
        yIsOdd = v == 1

        extSig = ExtendedSignature (H.Signature (fromIntegral r) (fromIntegral s)) yIsOdd
        otherEphemeral = hPubKeyToPubKey $
                            fromMaybe (error "malformed signature in tcpHandshakeServer") $
                            getPubKeyFromSignature extSig msg

    entropyPool <- liftIO createEntropyPool
    let g = cprgCreate entropyPool :: SystemRNG
        (myPriv', _) = generatePrivate g $ getCurveByName SEC_p256k1
        myEphemeral = calculatePublic theCurve myPriv'
        myNonce = 25 :: Word256
        ackMsg = AckMessage { ackEphemeralPubKey=myEphemeral, ackNonce=myNonce, ackKnownPeer=False }
        
    eciesMsgOBytes <- liftIO $ fmap BL.toStrict $ ECIES.encrypt myPriv' otherPoint (BL.toStrict $ encode $ ackMsg) B.empty

    yield $ eciesMsgOBytes

    let SharedKey ephemeralSharedSecret = getShared theCurve myPriv' otherEphemeral
        ephemeralSharedSecretBytes = intToBytes ephemeralSharedSecret

        myNonceBS = B.pack $ word256ToBytes myNonce
        frameDecKey = otherNonce `add`
                        myNonceBS `add`
                        (B.pack ephemeralSharedSecretBytes) `add`
                        (B.pack ephemeralSharedSecretBytes)
        macEncKey = frameDecKey `add` (B.pack ephemeralSharedSecretBytes)

    return $ Just (
      EthCryptState { --encrypt
         aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
         mac=SHA3.update (SHA3.init 256) $ (macEncKey `bXor` otherNonce) `B.append` eciesMsgOBytes,
         key=macEncKey
         },
      EthCryptState { --decrypt
        aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
        mac=SHA3.update (SHA3.init 256) $ (macEncKey `bXor` myNonceBS) `B.append` (BL.toStrict hsBytes),
        key=macEncKey
        }
      )





{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}

module Blockchain.RLPx (
  ethCryptConnect,
  ethCryptAccept
  ) where

import                 Control.Exception
import                 Control.Monad
import                 Control.Monad.IO.Class
import "cipher-aes"    Crypto.Cipher.AES
import "cryptonite"    Crypto.Hash                       (hashInitWith, hashUpdate)
import                 Crypto.Hash.Algorithms            (Keccak_256(..))
import                 Crypto.Types.PubKey.ECC
import                 Data.Binary
import                 Data.Bits
import qualified       Data.ByteString                   as B
import qualified       Data.ByteString.Lazy              as BL
import                 Data.Conduit
import qualified       Data.Conduit.Binary               as CB
import                 Data.Maybe

import qualified       Blockchain.AESCTR                 as AES
import                 Blockchain.Data.PubKey
import                 Blockchain.Data.RLP
import qualified       Blockchain.ECIES                  as ECIES
import                 Blockchain.Error
import                 Blockchain.EthEncryptionException
import                 Blockchain.ExtWord
import                 Blockchain.Frame
import                 Blockchain.Handshake
import                 Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)

import                 Blockchain.ECDSA


bXor :: B.ByteString
     -> B.ByteString
     -> B.ByteString
bXor x y | B.length x == B.length y = B.pack $ B.zipWith xor x y
bXor _ _ = error' "bXor called with two ByteStrings of different length"

ethCryptConnect :: (MonadIO m, HasVault m)
                => PublicPoint
                -> ConduitM B.ByteString B.ByteString m (EthCryptState, EthCryptState)
ethCryptConnect otherPubKey = do

  let myNonce = word256ToBytes 20 --TODO- Important!  Don't hardcode this

  handshakeInitBytes <- getHandshakeBytes otherPubKey myNonce
  yield handshakeInitBytes

  handshakeReplyBytes <- CB.take 210

  when (BL.length handshakeReplyBytes /= 210) $ liftIO $ throwIO $ HandshakeException "handshake reply didn't contain enough bytes"

  eAckBS <- ECIES.decrypt handshakeReplyBytes B.empty

  let ackMsg = bytesToAckMsg $ either (error . ("error in ethCryptConnect"++)) id eAckBS 
  
  SharedKey shared <- getShared $ pointToSecPubKey $ ackEphemeralPubKey ackMsg


  let m_originated      = False -- hardcoded for now, I can only connect as client
      otherNonce        = word256ToBytes $ ackNonce ackMsg
      frameDecKey       = myNonce `add` otherNonce `add` shared `add` shared
      macEncKey         = frameDecKey `add` shared
      ingressCipher     = if m_originated then handshakeInitBytes else BL.toStrict handshakeReplyBytes
      egressCipher      = if m_originated then BL.toStrict handshakeReplyBytes else handshakeInitBytes

  return (
          EthCryptState { --encrypt
                          aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
                          mac=hashUpdate (hashInitWith Keccak_256) $ (macEncKey `bXor` otherNonce) `B.append` egressCipher,
                          key=macEncKey
          },
          EthCryptState { --decrypt
                          aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
                          mac=hashUpdate (hashInitWith Keccak_256) $ (macEncKey `bXor` myNonce) `B.append` ingressCipher,
                          key=macEncKey
          }
         )

add :: B.ByteString
    -> B.ByteString
    -> B.ByteString
add acc val | B.length acc ==32 && B.length val == 32 = keccak256ToByteString $ hash $ val `B.append` acc
add _ _     = error "add called with ByteString of length not 32"


ethCryptAccept :: (MonadIO m, HasVault m)
               => Point
               -> ConduitM B.ByteString B.ByteString m (EthCryptState, EthCryptState)
ethCryptAccept otherPoint = do
  
  hsBytes <- CB.take 323 -- was 307... new binary encoded sigV is 16 bytes (not 1) for some reason
  
  hs <- ECIES.decrypt hsBytes B.empty
  maybeResult <-
    case hs of
     Left _  -> return Nothing
     Right x -> ethCryptAcceptOld otherPoint hsBytes x
  

  case maybeResult of
   Just x -> return x
   Nothing -> do
     let (first:second:_) = BL.unpack hsBytes
         fullSize = fromIntegral first*256 + fromIntegral second
         remainingSize = fullSize - 323 + 2 -- was 307
     remainingBytes <- CB.take remainingSize
     let fullBuffer = BL.drop 2 $ hsBytes `BL.append` remainingBytes
     maybeEciesMsgIBytes <- ECIES.decrypt fullBuffer $ BL.toStrict $ BL.take 2 $ hsBytes `BL.append` remainingBytes
     let eciesMsgIBytes = either (error . (++ ": " ++ show (BL.unpack fullBuffer)) . ("Malformed packed sent from peer: " ++)) id maybeEciesMsgIBytes
     ethCryptAcceptEIP8 otherPoint (hsBytes `BL.append` remainingBytes) eciesMsgIBytes


ethCryptAcceptEIP8 :: (MonadIO m, HasVault m)
                   => Point
                   -> BL.ByteString
                   -> B.ByteString
                   -> ConduitM B.ByteString B.ByteString m (EthCryptState, EthCryptState)
ethCryptAcceptEIP8 _ hsBytes eciesMsgIBytes = do

  let (RLPArray [signatureRLP, pubKeyRLP, otherNonceRLP, versionRLP], _) = rlpSplit eciesMsgIBytes
      otherNonce = rlpDecode otherNonceRLP
      pubKey = rlpDecode pubKeyRLP::B.ByteString
      extSig = rlpDecode signatureRLP
      version = rlpDecode versionRLP::Integer

  let otherPoint = bytesToPoint pubKey

  when (version /= 4) $ error "wrong version in packet sent to ethCryptAcceptEIP8"

  SharedKey sharedKey <- getShared $ pointToSecPubKey otherPoint
  let msg = word256ToBytes $ bytesToWord256 sharedKey `xor` bytesToWord256 otherNonce
      otherEphemeral = secPubKeyToPoint $
                            fromMaybe (error "malformed signature in tcpHandshakeServer") $
                            recoverPub extSig msg

  ephemeralPriv <- liftIO $ newPrivateKey
  let myEphemeral = secPubKeyToPoint $ derivePublicKey ephemeralPriv
      myNonce = 25 :: Word256
      ackMsg = AckMessage { ackEphemeralPubKey=myEphemeral, ackNonce=myNonce, ackKnownPeer=False }
      cryptSecret = deriveSharedKey ephemeralPriv (pointToSecPubKey otherPoint)

  eciesMsgOBytes <- fmap BL.toStrict $ ECIES.encrypt cryptSecret myEphemeral (BL.toStrict $ encode $ ackMsg) B.empty

  yield $ eciesMsgOBytes

  let SharedKey ephemeralSharedSecret = deriveSharedKey ephemeralPriv $ pointToSecPubKey otherEphemeral
      myNonceBS = word256ToBytes myNonce
      frameDecKey = otherNonce `add`
                        myNonceBS `add`
                        ephemeralSharedSecret `add`
                        ephemeralSharedSecret
      macEncKey = frameDecKey `add` ephemeralSharedSecret

  return (
      EthCryptState { --encrypt
         aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
         mac=hashUpdate (hashInitWith Keccak_256) $ (macEncKey `bXor` otherNonce) `B.append` eciesMsgOBytes,
         key=macEncKey
         },
      EthCryptState { --decrypt
        aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
        mac=hashUpdate (hashInitWith Keccak_256) $ (macEncKey `bXor` myNonceBS) `B.append` (BL.toStrict hsBytes),
        key=macEncKey
        }
      )

ethCryptAcceptOld :: (MonadIO m, HasVault m)
                  => Point
                  -> BL.ByteString
                  -> B.ByteString
                  -> ConduitM B.ByteString B.ByteString m (Maybe (EthCryptState, EthCryptState))
ethCryptAcceptOld otherPoint hsBytes eciesMsgIBytes = do

    SharedKey sharedKey <- getShared $ pointToSecPubKey otherPoint
    let otherNonce = B.take 32 $ B.drop 177 $ eciesMsgIBytes -- was B.drop 161
        msg = word256ToBytes $ bytesToWord256 sharedKey `xor` bytesToWord256 otherNonce
        extSig = decode $ BL.fromStrict eciesMsgIBytes
        otherEphemeral = secPubKeyToPoint $
                            fromMaybe (error "malformed signature in tcpHandshakeServer") $
                            recoverPub extSig msg
    
    ephemeralPriv <- liftIO $ newPrivateKey
    let myEphemeral = secPubKeyToPoint $ derivePublicKey ephemeralPriv
        myNonce = 25 :: Word256
        ackMsg = AckMessage { ackEphemeralPubKey=myEphemeral, ackNonce=myNonce, ackKnownPeer=False }
        cryptSecret = deriveSharedKey ephemeralPriv (pointToSecPubKey otherPoint)
    eciesMsgOBytes <- fmap BL.toStrict $ ECIES.encrypt cryptSecret myEphemeral (BL.toStrict $ encode $ ackMsg) B.empty

    yield $ eciesMsgOBytes

    let SharedKey ephemeralSharedSecret = deriveSharedKey ephemeralPriv $ pointToSecPubKey otherEphemeral
        myNonceBS = word256ToBytes myNonce
        frameDecKey = otherNonce `add`
                        myNonceBS `add`
                        ephemeralSharedSecret `add`
                        ephemeralSharedSecret
        macEncKey = frameDecKey `add` ephemeralSharedSecret

    return $ Just (
      EthCryptState { --encrypt
         aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
         mac=hashUpdate (hashInitWith Keccak_256) $ (macEncKey `bXor` otherNonce) `B.append` eciesMsgOBytes,
         key=macEncKey
         },
      EthCryptState { --decrypt
        aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
        mac=hashUpdate (hashInitWith Keccak_256) $ (macEncKey `bXor` myNonceBS) `B.append` (BL.toStrict hsBytes),
        key=macEncKey
        }
      )

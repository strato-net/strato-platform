{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.RLPx
  ( ethCryptConnect,
    ethCryptAccept,
  )
where

import qualified Blockchain.AESCTR as AES
import Blockchain.Data.PubKey
import Blockchain.Data.RLP
import qualified Blockchain.ECIES as ECIES
import Blockchain.Error
import Blockchain.EthEncryptionException
import Blockchain.Frame
import Blockchain.Handshake
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Blockchain.Strato.Model.Secp256k1
import Control.Exception
import Control.Monad
import Control.Monad.Composable.Vault
import Control.Monad.IO.Class
import "cipher-aes" Crypto.Cipher.AES
import "cryptonite" Crypto.Hash (hashInitWith, hashUpdate)
import "cryptonite" Crypto.Random.Entropy (getEntropy)
import Crypto.Hash.Algorithms (Keccak_256 (..))
import Crypto.Types.PubKey.ECC
import Data.Binary
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Conduit
import qualified Data.Conduit.Binary as CB
import Data.Maybe

bXor ::
  B.ByteString ->
  B.ByteString ->
  B.ByteString
bXor x y | B.length x == B.length y = B.pack $ B.zipWith xor x y
bXor _ _ = error' "bXor called with two ByteStrings of different length"

ethCryptConnect ::
  (MonadIO m, HasVault m) =>
  PublicPoint ->
  ConduitM B.ByteString B.ByteString m (EthCryptState, EthCryptState)
ethCryptConnect otherPubKey = do
  -- Fresh for every connection. The nonce goes to the peer encrypted to its
  -- static key and into the session keys, so only the peer we dialed can
  -- derive them: with a fixed nonce, anyone answering in its place could. The
  -- ephemeral key keeps a later leak of our static key from opening this
  -- session.
  myNonce <- liftIO $ getEntropy 32
  ephemeralPriv <- liftIO newPrivateKey
  handshakeInitBytes <- getHandshakeBytes ephemeralPriv otherPubKey myNonce
  yield handshakeInitBytes

  handshakeReplyBytes <- CB.take 210
  when (BL.length handshakeReplyBytes /= 210) $ liftIO $ throwIO $ HandshakeException "handshake reply didn't contain enough bytes!!"
  eAckBS <- ECIES.decrypt handshakeReplyBytes B.empty

  let ackMsg = bytesToAckMsg $ either (error . ("error in ethCryptConnect" ++)) id eAckBS

  let SharedKey shared = deriveSharedKey ephemeralPriv $ pointToSecPubKey $ ackEphemeralPubKey ackMsg
      m_originated = False -- hardcoded for now, I can only connect as client
      otherNonce = word256ToBytes $ ackNonce ackMsg
      frameDecKey = myNonce `add` otherNonce `add` shared `add` shared
      macEncKey = frameDecKey `add` shared
      ingressCipher = if m_originated then handshakeInitBytes else BL.toStrict handshakeReplyBytes
      egressCipher = if m_originated then BL.toStrict handshakeReplyBytes else handshakeInitBytes

  return
    ( EthCryptState --encrypt
        { aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
          mac = hashUpdate (hashInitWith Keccak_256) $ (macEncKey `bXor` otherNonce) `B.append` egressCipher,
          key = macEncKey
        },
      EthCryptState --decrypt
        { aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
          mac = hashUpdate (hashInitWith Keccak_256) $ (macEncKey `bXor` myNonce) `B.append` ingressCipher,
          key = macEncKey
        }
    )

add ::
  B.ByteString ->
  B.ByteString ->
  B.ByteString
add acc val | B.length acc == 32 && B.length val == 32 = keccak256ToByteString $ hash $ val `B.append` acc
add _ _ = error "add called with ByteString of length not 32"

ethCryptAccept ::
  (MonadIO m, HasVault m) =>
  ConduitM B.ByteString B.ByteString m (Point, EthCryptState, EthCryptState)
ethCryptAccept = do
  hsBytes <- CB.take 307
  hs <- ECIES.decryptAndGetPubKey hsBytes B.empty
  maybeResult <-
    case hs of
      Left _ -> return Nothing
      Right (otherPoint, x) -> ethCryptAcceptOld otherPoint hsBytes x

  case maybeResult of
    Just x -> return x
    Nothing -> do
      let (first, second) = case BL.unpack hsBytes of
            (x : y : _) -> (x, y)
            _ -> error "Malformed handshake sent from peer"
          fullSize = fromIntegral first * 256 + fromIntegral second
          remainingSize = fullSize - 307 + 2
      remainingBytes <- CB.take remainingSize
      let fullBuffer = BL.drop 2 $ hsBytes `BL.append` remainingBytes
      maybeEciesMsgIBytes <- ECIES.decrypt fullBuffer $ BL.toStrict $ BL.take 2 $ hsBytes `BL.append` remainingBytes
      let eciesMsgIBytes = either (error . (++ ": " ++ show (BL.unpack fullBuffer)) . ("Malformed packed sent from peer: " ++)) id maybeEciesMsgIBytes
      ethCryptAcceptEIP8 (hsBytes `BL.append` remainingBytes) eciesMsgIBytes

ethCryptAcceptEIP8 ::
  (MonadIO m, HasVault m) =>
  BL.ByteString ->
  B.ByteString ->
  ConduitM B.ByteString B.ByteString m (Point, EthCryptState, EthCryptState)
ethCryptAcceptEIP8 hsBytes eciesMsgIBytes = do
  --let (RLPArray [signatureRLP, pubKeyRLP, otherNonceRLP, versionRLP], _) = rlpSplit eciesMsgIBytes
  let (signatureRLP, pubKeyRLP, otherNonceRLP, versionRLP) = case rlpSplit eciesMsgIBytes of
        (RLPArray [a, b, c, d], _) -> (a, b, c, d)
        _ -> error "malformed packet sent to ethCryptAcceptEIP8"
      otherNonce = rlpDecode otherNonceRLP
      pubKey = rlpDecode pubKeyRLP :: B.ByteString
      extSig = rlpDecode signatureRLP
      version = rlpDecode versionRLP :: Integer

  let otherPoint = bytesToPoint pubKey

  when (version /= 4) $ error "wrong version in packet sent to ethCryptAcceptEIP8"

  SharedKey sharedKey <- getShared $ pointToSecPubKey otherPoint
  let msg = word256ToBytes $ bytesToWord256 sharedKey `xor` bytesToWord256 otherNonce
      otherEphemeral =
        secPubKeyToPoint $
          fromMaybe (error "malformed signature in tcpHandshakeServer") $
            recoverPub extSig msg

  ephemeralPriv <- liftIO $ newPrivateKey
  let myEphemeral = secPubKeyToPoint $ derivePublicKey ephemeralPriv
      myNonce = 25 :: Word256
      ackMsg = AckMessage {ackEphemeralPubKey = myEphemeral, ackNonce = myNonce, ackKnownPeer = False}
      cryptSecret = deriveSharedKey ephemeralPriv (pointToSecPubKey otherPoint)

  eciesMsgOBytes <- fmap BL.toStrict $ ECIES.encrypt cryptSecret myEphemeral (BL.toStrict $ encode $ ackMsg) B.empty

  yield $ eciesMsgOBytes

  let SharedKey ephemeralSharedSecret = deriveSharedKey ephemeralPriv $ pointToSecPubKey otherEphemeral
      myNonceBS = word256ToBytes myNonce
      frameDecKey =
        otherNonce
          `add` myNonceBS
          `add` ephemeralSharedSecret
          `add` ephemeralSharedSecret
      macEncKey = frameDecKey `add` ephemeralSharedSecret

  return
    ( otherPoint,
      EthCryptState --encrypt
        { aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
          mac = hashUpdate (hashInitWith Keccak_256) $ (macEncKey `bXor` otherNonce) `B.append` eciesMsgOBytes,
          key = macEncKey
        },
      EthCryptState --decrypt
        { aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
          mac = hashUpdate (hashInitWith Keccak_256) $ (macEncKey `bXor` myNonceBS) `B.append` (BL.toStrict hsBytes),
          key = macEncKey
        }
    )

ethCryptAcceptOld ::
  (MonadIO m, HasVault m) =>
  Point ->
  BL.ByteString ->
  B.ByteString ->
  ConduitM B.ByteString B.ByteString m (Maybe (Point, EthCryptState, EthCryptState))
ethCryptAcceptOld otherPoint hsBytes eciesMsgIBytes = do
  SharedKey sharedKey <- getShared $ pointToSecPubKey otherPoint
  let otherNonce = B.take 32 $ B.drop 161 $ eciesMsgIBytes
      msg = word256ToBytes $ bytesToWord256 sharedKey `xor` bytesToWord256 otherNonce
      extSig = importSignature $ B.take 65 eciesMsgIBytes
  case extSig of
    Left err -> error err
    Right sig -> do
      let otherEphemeral =
            secPubKeyToPoint $
              fromMaybe (error "malformed signature in tcpHandshakeServer") $
                recoverPub sig msg

      ephemeralPriv <- liftIO $ newPrivateKey
      let myEphemeral = secPubKeyToPoint $ derivePublicKey ephemeralPriv
          myNonce = 25 :: Word256
          ackMsg = AckMessage {ackEphemeralPubKey = myEphemeral, ackNonce = myNonce, ackKnownPeer = False}
          cryptSecret = deriveSharedKey ephemeralPriv (pointToSecPubKey otherPoint)
      eciesMsgOBytes <- fmap BL.toStrict $ ECIES.encrypt cryptSecret myEphemeral (BL.toStrict $ encode $ ackMsg) B.empty

      yield $ eciesMsgOBytes

      let SharedKey ephemeralSharedSecret = deriveSharedKey ephemeralPriv $ pointToSecPubKey otherEphemeral
          myNonceBS = word256ToBytes myNonce
          frameDecKey =
            otherNonce
              `add` myNonceBS
              `add` ephemeralSharedSecret
              `add` ephemeralSharedSecret
          macEncKey = frameDecKey `add` ephemeralSharedSecret

      return $
        Just
          ( otherPoint,
            EthCryptState --encrypt
              { aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
                mac = hashUpdate (hashInitWith Keccak_256) $ (macEncKey `bXor` otherNonce) `B.append` eciesMsgOBytes,
                key = macEncKey
              },
            EthCryptState --decrypt
              { aesState = AES.AESCTRState (initAES frameDecKey) (aesIV_ $ B.replicate 16 0) 0,
                mac = hashUpdate (hashInitWith Keccak_256) $ (macEncKey `bXor` myNonceBS) `B.append` (BL.toStrict hsBytes),
                key = macEncKey
              }
          )

{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}

module Blockchain.Handshake
  ( AckMessage (..),
    getHandshakeBytes,
    bytesToAckMsg,
  )
where

import Blockchain.Data.PubKey
import qualified Blockchain.ECIES as ECIES
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Blockchain.Strato.Model.Secp256k1
import Control.Monad.IO.Class
import Crypto.Types.PubKey.ECC
import Data.Binary
import Data.Binary.Get
import Data.Binary.Put
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Maybe

data AckMessage = AckMessage
  { ackEphemeralPubKey :: Point,
    ackNonce :: Word256,
    ackKnownPeer :: Bool
  }
  deriving (Show)

knownPeer :: Word8 -> Bool
knownPeer b =
  case b of
    0 -> False
    1 -> True
    _ -> error "byte is neither 0 nor 1"

boolToWord8 :: Bool -> Word8
boolToWord8 True = 1
boolToWord8 False = 0

errorHead :: String -> [a] -> a
errorHead _ (x : _) = x
errorHead msg _ = error msg

instance Binary AckMessage where
  get = do
    point <- bytesToPoint <$> getByteString 64
    nonce <- bytesToWord256 <$> getByteString 32
    kp <- fmap (knownPeer . errorHead "head error in instance Binary AckMessage" . B.unpack) $ getByteString 1
    return $ (AckMessage point nonce kp)

  put (AckMessage point nonce kp) = do
    putByteString . pointToBytes $ point
    putByteString . word256ToBytes $ nonce
    putByteString . B.singleton . boolToWord8 $ kp

bytesToAckMsg :: B.ByteString -> AckMessage
bytesToAckMsg bytes
  | B.length bytes == 97 =
    AckMessage
      { ackEphemeralPubKey = bytesToPoint $ B.take 64 bytes,
        ackNonce = bytesToWord256 $ B.take 32 $ B.drop 64 bytes,
        ackKnownPeer =
          case bytes `B.index` 96 of
            0 -> False
            1 -> True
            _ -> error "known peer byte in ackMessage is neither 0 nor 1"
      }
bytesToAckMsg _ = error "wrong number of bytes in call to bytesToECIESMsg"

getHandshakeBytes :: (MonadIO m, HasVault m) => PublicPoint -> B.ByteString -> m B.ByteString
getHandshakeBytes otherPubKey myNonce = do
  myPublic' <- getPub
  SharedKey sharedKey <- getShared $ pointToSecPubKey otherPubKey

  let myPublic = secPubKeyToPoint myPublic'
      msg = word256ToBytes $ bytesToWord256 sharedKey `xor` bytesToWord256 myNonce

  sig <- sign msg

  -- this signature recovery is pointless - the "ephermal" key is actually just myPublic
  let ephemeral =
        fromMaybe (error "malformed signature given to call getHandshakeBytes") $
          recoverPub sig msg
      hepubk = keccak256ToByteString $ hash $ pointToBytes $ secPubKeyToPoint ephemeral
      pubk = pointToBytes myPublic
      theData =
        (exportSignature sig)
          `B.append` hepubk
          `B.append` pubk
          `B.append` myNonce
          `B.append` B.singleton 0 -- TODO: would be nice to have binary instances here, not just raw BS stuff
  eciesMsgBytes <- fmap BL.toStrict $ ECIES.encrypt (SharedKey sharedKey) myPublic theData B.empty

  return $ eciesMsgBytes

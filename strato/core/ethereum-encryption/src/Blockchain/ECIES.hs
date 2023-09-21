{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE PackageImports #-}

module Blockchain.ECIES
  ( decrypt,
    encrypt,
    theCurve,
  )
where

import Blockchain.Data.PubKey
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Secp256k1
import Codec.Utils
import Control.Monad
import Control.Monad.IO.Class
import "cipher-aes" Crypto.Cipher.AES
import Crypto.Hash.SHA256
import Crypto.Types.PubKey.ECC
import Data.Binary
import Data.Binary.Get
import Data.Binary.Put
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.HMAC
import System.Entropy

theCurve :: Curve
theCurve = getCurveByName SEC_p256k1

encrypt :: MonadIO m => SharedKey -> Point -> B.ByteString -> B.ByteString -> m BL.ByteString
encrypt sharedKey myPubKey bytes prefix = do
  cipherIV <- liftIO $ getEntropy 16
  return $ encode $ encryptECIES sharedKey myPubKey cipherIV bytes prefix

decrypt :: HasVault m => BL.ByteString -> B.ByteString -> m (Either String B.ByteString)
decrypt bytes prefix = do
  let eciesMsg = decode bytes

  --Special case of the next check, indicates that a different key encoding was used
  when (eciesForm eciesMsg `elem` [2, 3]) $ error "peer connected with unsupported handshake packet"

  if (eciesForm eciesMsg /= 4)
    then return $ Left $ "first byte of buffer must be 4: " ++ show (BL.unpack bytes)
    else do
      sharedKey <- getShared $ pointToSecPubKey $ eciesPubKey eciesMsg

      let msg = decryptECIES sharedKey eciesMsg
          (expectedMac, _) = getMacAndCipher sharedKey (eciesCipherIV eciesMsg) msg prefix

      if (eciesMac eciesMsg /= expectedMac)
        then
          return $
            Left $
              "mac doesn't match: expected " ++ show expectedMac
                ++ ", got "
                ++ show (eciesMac eciesMsg)
        else return $ Right msg

-----------------

--intToBytes  ::  Integer->[Word8]
--intToBytes x = map (fromIntegral . (x `shiftR`)) [256-8, 256-16..0]

ctr :: [Word8]
ctr = [0, 0, 0, 1]

--s1  ::  [Word8]
--s1 = []

data ECIESMessage = ECIESMessage
  { eciesForm :: Word8, --See ansi x9.62 section 4.3.6 (I currently only handle form=4)
    eciesPubKey :: Point,
    eciesCipherIV :: B.ByteString,
    eciesCipher :: B.ByteString,
    eciesMac :: [Word8]
  }
  deriving (Show)

instance Binary ECIESMessage where
  get = do
    bs <- getRemainingLazyByteString
    let bsStrict = BL.toStrict $ bs
        theLength = B.length $ bsStrict
        form =
          errorHead "bsStrict is null" $
            B.unpack $ bsStrict
        pubKeyX = toInteger . bytesToWord256 $ B.take 32 $ B.drop 1 $ bsStrict
        pubKeyY = toInteger . bytesToWord256 $ B.take 32 $ B.drop 33 $ bsStrict
        cipherIV = B.take 16 $ B.drop 65 $ bsStrict
        cipher = B.take (theLength - 113) $ B.drop 81 $ bsStrict
        mac = B.unpack $ B.take 32 $ B.drop (theLength - 32) bsStrict
    -- form <- getWord8
    -- pubKeyX <- fmap (toInteger . bytesToWord256) $ getByteString 32
    -- pubKeyY <- fmap (toInteger . bytesToWord256) $ getByteString 32
    -- cipherIV <- getByteString 16
    -- cipher <- getByteString (length - (113))
    -- mac <- sequence $ replicate 32 getWord8
    return $ ECIESMessage form (Point pubKeyX pubKeyY) cipherIV cipher mac

  put (ECIESMessage form (Point pubKeyX pubKeyY) cipherIV cipher mac) = do
    putWord8 form
    putByteString . word256ToBytes . fromInteger $ pubKeyX
    putByteString . word256ToBytes . fromInteger $ pubKeyY
    putByteString cipherIV
    putByteString cipher
    sequence_ $ map putWord8 mac
  put x = error $ "unsupported case in call to put for ECIESMessage: " ++ show x

errorHead :: String -> [a] -> a
errorHead _ (x : _) = x
errorHead msg _ = error msg

encrypt' :: B.ByteString -> B.ByteString -> B.ByteString -> B.ByteString
encrypt' key cipherIV input = encryptCTR (initAES key) cipherIV input

getMacAndCipher :: SharedKey -> B.ByteString -> B.ByteString -> B.ByteString -> ([Octet], B.ByteString)
getMacAndCipher (SharedKey sharedKey) cipherIV msg prefix =
  ( hmac (HashMethod (B.unpack . hash . B.pack) 512) (B.unpack mKey) (B.unpack cipherWithIV ++ B.unpack prefix),
    cipher
  )
  where
    cipherWithIV = cipherIV `B.append` cipher
    key = hash $ B.pack ctr `B.append` sharedKey
    mKeyMaterial = B.take 16 $ B.drop 16 key
    mKey = hash mKeyMaterial
    eKey = B.take 16 key
    cipher = encrypt' eKey cipherIV msg

encryptECIES :: SharedKey -> PublicPoint -> B.ByteString -> B.ByteString -> B.ByteString -> ECIESMessage
encryptECIES sharedKey myPubKey cipherIV msg prefix =
  ECIESMessage
    { eciesForm = 4, --form=4 indicates pubkey is not compressed
      eciesPubKey = myPubKey,
      eciesCipherIV = cipherIV,
      eciesCipher = cipher,
      eciesMac = mac
    }
  where
    (mac, cipher) = getMacAndCipher sharedKey cipherIV msg prefix

decryptECIES :: SharedKey -> ECIESMessage -> B.ByteString
decryptECIES (SharedKey sharedKey) msg =
  let key = hash $ B.pack ctr `B.append` sharedKey
      eKey = B.take 16 key
   in encryptCTR (initAES eKey) (eciesCipherIV msg) (eciesCipher msg)

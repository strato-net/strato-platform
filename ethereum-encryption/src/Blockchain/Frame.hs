{-# LANGUAGE LambdaCase        #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RankNTypes        #-}
{-# LANGUAGE TemplateHaskell   #-}
module Blockchain.Frame
  ( EthCryptState(..)
  , ethEncrypt
  , ethDecrypt
  , cbSafeTake
  ) where

import qualified Blockchain.AESCTR                 as AES
import           Blockchain.Error
import           Blockchain.EthEncryptionException
import           Control.Exception.Lifted
import           Control.Monad
import           Control.Monad.Logger
import           Crypto.Cipher.AES
import qualified Crypto.Hash.SHA3                  as SHA3
import           Data.Bits
import qualified Data.ByteString                   as B
import qualified Data.ByteString.Lazy              as BL
import           Data.Conduit
import qualified Data.Conduit.Binary               as CB
import           Data.Maybe

bXor :: B.ByteString->B.ByteString->B.ByteString
bXor x y | B.length x == B.length y = B.pack $ B.zipWith xor x y
bXor x y = error' $
           "bXor called with two ByteStrings of different length: length string1 = " ++
           show (B.length x) ++ ", length string2 = " ++ show (B.length y)

data EthCryptState = EthCryptState { aesState :: AES.AESCTRState
                                   , mac      :: SHA3.Ctx
                                   , key      :: B.ByteString
                                   }

instance Show EthCryptState where
  show = show . key

rawUpdateMac :: SHA3.Ctx
             -> B.ByteString
             -> (SHA3.Ctx, B.ByteString)
rawUpdateMac theMac value =
  let mac' = SHA3.update theMac value
  in (mac', B.take 16 $ SHA3.finalize mac')

updateMac :: SHA3.Ctx
          -> B.ByteString
          -> B.ByteString
          -> (SHA3.Ctx, B.ByteString)
updateMac theMac theKey value =
  rawUpdateMac theMac $
    value `bXor` (encryptECB (initAES theKey) (B.take 16 $ SHA3.finalize theMac))

ethEncrypt :: (MonadLogger m, Monad m)
           => EthCryptState
           -> Conduit B.ByteString m B.ByteString
ethEncrypt ethCryptState = do
  await >>= \case
    Nothing -> return ()
    Just bytes -> do
      let frameSize = B.length bytes
          frameBuffSize = (16 - frameSize `mod` 16) `mod` 16
          header =
            B.pack [fromIntegral $ frameSize `shiftR` 16,
                    fromIntegral $ frameSize `shiftR` 8,
                    fromIntegral $ frameSize,
                    0xc2,
                    0x80,
                    0x80,
                    0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

      let (aesState', headCipher) = AES.encrypt (aesState ethCryptState) header
          (mac', headMAC) = updateMac (mac ethCryptState) (key ethCryptState) headCipher

      yield headCipher
      yield headMAC

      let (aesState'', frameCipher) = AES.encrypt aesState' (bytes `B.append` B.replicate frameBuffSize 0)
          (mac'', mid) = rawUpdateMac mac' frameCipher
          (mac''', frameMAC) = updateMac mac'' (key ethCryptState) mid

      yield frameCipher
      yield frameMAC

      ethEncrypt ethCryptState{aesState=aesState'', mac=mac'''}

cbSafeTake :: forall o m. Monad m
           => Int
           -> ConduitM B.ByteString o m (Maybe B.ByteString)
cbSafeTake i = do
    ret <- CB.take i
    if BL.length ret /= fromIntegral i
       then return Nothing
       else return . Just $ BL.toStrict ret

ethDecrypt :: (MonadLogger m, Monad m)
           => EthCryptState
           -> Conduit B.ByteString m B.ByteString
ethDecrypt ethCryptState = do
  headCipher <- fromMaybe (throw HeadCipherTooShort) <$> cbSafeTake 16
  headMAC    <- fromMaybe (throw HeadMACTooShort)    <$> cbSafeTake 16

  let (mac', expectedHeadMAC) = updateMac (mac ethCryptState) (key ethCryptState) headCipher
  when (expectedHeadMAC /= headMAC) $ throw HeadMacIncorrect

  let (aesState', header) = AES.decrypt (aesState ethCryptState) headCipher
      frameSize =
        (fromIntegral (header `B.index` 0) `shiftL` 16) +
        (fromIntegral (header `B.index` 1) `shiftL` 8) +
        fromIntegral (header `B.index` 2)
      frameBufferSize = (16 - (frameSize `mod` 16)) `mod` 16

  frameCipher <- fromMaybe (throw FrameCipherTooShort) <$> cbSafeTake (frameSize + frameBufferSize)
  frameMAC    <- fromMaybe (throw FrameMACTooShort)    <$> cbSafeTake 16

  let (mac'', mid) = rawUpdateMac mac' frameCipher
      (mac''', expectedFrameMAC) = updateMac mac'' (key ethCryptState) mid

  when (expectedFrameMAC /= frameMAC) $ throw FrameMacIncorrect
  let (aesState'', fullFrame) = AES.decrypt aesState' frameCipher
  yield $ B.take frameSize fullFrame
  ethDecrypt ethCryptState{aesState=aesState'', mac=mac'''}

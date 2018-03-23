{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric #-}

module Blockchain.Generation (
  encodeAllTypes,
  encodeJSON,
  insertContractsCount,
  insertContractsJSON,
  insertContracts,
  Records(..),
  Type(..)
) where

import Control.Monad (liftM)
import qualified Data.Aeson as Ae
import Data.Bits
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import Data.Scientific (floatingOrInteger)
import qualified Data.Text as T
import Data.Text.Encoding
import Data.Word
import GHC.Generics

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.SHA
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Data.GenesisInfo

data Type = Number Integer | Stryng T.Text
  deriving (Eq, Show, Generic)

instance Ae.FromJSON Type where
  parseJSON (Ae.String s) = return $ Stryng s
  parseJSON (Ae.Number x) = case floatingOrInteger x :: Either Double Integer of
                                Left f -> fail $ "must be int or string: " ++ show f
                                Right n -> return $ Number n
  parseJSON _ = fail "must be int or string"

newtype Records = Records [[Type]] deriving (Eq, Show, Generic)

instance Ae.FromJSON Records

equalChunksOf :: Int -> [Word8] -> [[Word8]]
equalChunksOf n ws | length ws == 0 = []
                   | length ws <= n = [ws ++ replicate (n - length ws) 0]
                   | otherwise = let (car, cdr) = splitAt n ws
                                 in car : (equalChunksOf n cdr)

encodeType :: Int -> Type -> Either String [(Word256, Word256)]
encodeType k (Number n) | n >= 0 && n <= (2 ^ (256 :: Integer)) = Right [(fromIntegral k, fromIntegral n)]
                        | otherwise = Left "unimplemented for negative numbers"
encodeType k (Stryng s) =
  if length payload < 32
      then let pad = replicate (31 - length payload) 0
               size = [fromIntegral $ length payload `shiftL` 1]
           in Right [(fromIntegral k, bytesToWord256 $ payload ++ pad ++ size)]
      else let size = fromIntegral $ (length payload `shiftL` 1) .|. 1
               pointer = (fromIntegral k, size)
               SHA start = superProprietaryStratoSHAHash . BS.pack . word256ToBytes . fromIntegral $ k
               packets = zip (map (start+) [0..]) . map bytesToWord256 . equalChunksOf 32 $ payload
           in Right $ pointer:packets
  where payload = BS.unpack . encodeUtf8 $ s

encodeAllTypes :: Records -> Either String [[(Word256, Word256)]]
encodeAllTypes (Records recs) = mapM (liftM concat . sequence . zipWith encodeType [0..]) recs

encodeJSON :: BS.ByteString -> Either String [[(Word256, Word256)]]
encodeJSON rawRecs = encodeAllTypes =<< Ae.eitherDecodeStrict rawRecs

insertContractsCount :: Int -> String -> BS.ByteString -> Address -> GenesisInfo -> Either String GenesisInfo
insertContractsCount n src code start gi = return $ insertContracts (replicate n []) src code start gi


insertContractsJSON :: BS.ByteString -> String -> BS.ByteString -> Address -> GenesisInfo -> Either String GenesisInfo
insertContractsJSON rawJSON src code start gi = do
  slotss <- encodeJSON rawJSON
  return $ insertContracts slotss src code start gi

insertContracts :: [[(Word256, Word256)]] -> String -> BS.ByteString -> Address -> GenesisInfo -> GenesisInfo
insertContracts slotss src code start gi =
  let initialAccounts = genesisInfoAccountInfo gi
      initialCode = genesisInfoCodeInfo gi
      (decoded, extra) = B16.decode code
      codeHash = if extra /= "" && extra /= "\n"
                   then error ("bytecode not encoded in base16:" ++ show code)
                   else superProprietaryStratoSHAHash decoded
      mkContract (addr, slots) = Contract addr 0 codeHash slots
      addrs = map (start+) [0..]
      addrsAndSlots = zip addrs slotss
  in gi {genesisInfoAccountInfo = initialAccounts ++ map mkContract addrsAndSlots,
         genesisInfoCodeInfo = initialCode ++ [CodeInfo decoded src]}

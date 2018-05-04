{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.Generation (
  encodeAllRecords,
  encodeJSON,
  insertContractsCount,
  insertContractsJSON,
  insertContracts,
  Records(..),
  Type(..)
) where

import Control.Monad ((<=<))
import qualified Data.Aeson as Ae
import Data.Bits
import qualified Data.ByteString.Lazy as L
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import qualified Data.List as List
import qualified Data.HashMap.Strict as HM
import Data.Scientific (floatingOrInteger)
import qualified Data.Text as T
import qualified Data.Vector as V
import Data.Text.Encoding
import Data.Word
import GHC.Generics

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.SHA
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Data.GenesisInfo

data Type = Number Integer | Stryng T.Text | List (V.Vector Type) | Struct [Type]
  deriving (Eq, Show, Generic)

instance Ae.FromJSON Type where
  parseJSON (Ae.String s) = return $ Stryng s
  parseJSON (Ae.Number x) = case floatingOrInteger x :: Either Double Integer of
                                Left f -> fail $ "must be int or string: " ++ show f
                                Right n -> return $ Number n
  parseJSON (Ae.Array as) = List <$> V.mapM Ae.parseJSON as
  parseJSON (Ae.Object ss) = let a `cmp` b = fst a `compare` fst b
                             in Struct <$> (mapM (Ae.parseJSON . snd) . List.sortBy cmp . HM.toList $ ss)
  parseJSON _ = fail "must be int or string"

newtype Records = Records [[Type]] deriving (Eq, Show, Generic)

instance Ae.FromJSON Records

equalChunksOf :: Int -> [Word8] -> [[Word8]]
equalChunksOf n ws | length ws == 0 = []
                   | length ws <= n = [ws ++ replicate (n - length ws) 0]
                   | otherwise = let (car, cdr) = splitAt n ws
                                 in car : (equalChunksOf n cdr)

hash :: Word256 -> Word256
hash x = let SHA w = superProprietaryStratoSHAHash . BS.pack . word256ToBytes $ x
         in w

encodeSequentially :: Word256 -> [Type] -> Either String ([(Word256, Word256)], Word256)
encodeSequentially k [] = return ([], k)
encodeSequentially k (t:ts) = do
  (tSlots, k') <- encodeType k t
  (tsSlots, k'') <- encodeSequentially k' ts
  return (tSlots ++ tsSlots, k'')

-- First return value is the slots for this value, and the second return value
-- is the next available slot.
encodeType :: Word256 -> Type -> Either String ([(Word256, Word256)], Word256)
encodeType k (Number n) | n >= 0 && n <= (2 ^ (256 :: Integer)) = Right ([(k, fromIntegral n)], k + 1)
                        | otherwise = Left "unimplemented for negative numbers"
encodeType k (Stryng s) =
  if length payload < 32
      then let pad = replicate (31 - length payload) 0
               size = [fromIntegral $ length payload `shiftL` 1]
           in Right ([(k, bytesToWord256 $ payload ++ pad ++ size)], k+1)
      else let size = fromIntegral $ (length payload `shiftL` 1) .|. 1
               pointer = (k, size)
               start = hash k
               packets = zip (map (start+) [0..]) . map bytesToWord256 . equalChunksOf 32 $ payload
           in Right (pointer:packets, k + 1)
  where payload = BS.unpack . encodeUtf8 $ s
encodeType k (List payload) =
  let size = fromIntegral . length $ payload
      pointer = (k, size)
      start = hash k
  in do
      (packets, _) <- encodeSequentially start (V.toList payload)
      return (pointer:packets, k + 1)
encodeType k (Struct ts) = encodeSequentially k ts

encodeRecord :: Word256 -> [Type] -> Either String [(Word256, Word256)]
encodeRecord k ts = fst <$> encodeSequentially k ts

encodeAllRecords :: Records -> Either String [[(Word256, Word256)]]
encodeAllRecords (Records recs) = mapM (encodeRecord 0) recs

encodeJSON :: L.ByteString -> Either String [[(Word256, Word256)]]
encodeJSON = encodeAllRecords <=< Ae.eitherDecode

insertContractsCount :: Int -> String -> String -> BS.ByteString -> Address -> GenesisInfo -> Either String GenesisInfo
insertContractsCount n name src code start gi = return $ insertContracts (replicate n []) name src code start gi


insertContractsJSON :: L.ByteString -> String -> String -> BS.ByteString -> Address -> GenesisInfo -> Either String GenesisInfo
insertContractsJSON rawJSON name src code start gi = do
  slotss <- encodeJSON rawJSON
  return $ insertContracts slotss name src code start gi

insertContracts :: [[(Word256, Word256)]] -> String -> String -> BS.ByteString -> Address -> GenesisInfo -> GenesisInfo
insertContracts slotss name src code start gi =
  let initialAccounts = genesisInfoAccountInfo gi
      initialCode = genesisInfoCodeInfo gi
      (decoded, extra) = B16.decode code
      codeHash = if extra /= "" && extra /= "\n"
                   then error ("bytecode not encoded in base16:" ++ show code)
                   else superProprietaryStratoSHAHash decoded
      mkContract (addr, slots) = ContractWithStorage addr 0 codeHash slots
      addrs = map (start+) [0..]
      addrsAndSlots = zip addrs slotss
  in gi {genesisInfoAccountInfo = initialAccounts ++ map mkContract addrsAndSlots,
         genesisInfoCodeInfo = initialCode ++ [CodeInfo decoded name src]}

{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.Generation (
  encodeAllRecords,
  encodeJSON,
  encodeJSONHashMaps,
  insertContractsCount,
  insertContractsJSON,
  insertContractsJSONHashMaps,
  insertContracts,
  Records(..),
  RecordsHashMap(..),
  Type(..),
  TypeHashMap(..)
) where

import qualified Data.Aeson as Ae
import qualified Data.JsonStream.Parser as JS
import Data.Bits
import qualified Data.ByteString.Lazy as L
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import qualified Data.List as List
import qualified Data.HashMap.Strict as HM
import Data.Scientific (floatingOrInteger)
import           Data.Text (Text)
import qualified Data.Vector as V
import Data.Text.Encoding
import Data.Word
import GHC.Generics

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.SHA
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Data.GenesisInfo
import Blockchain.Data.ChainInfo

data Type = Number Integer
          | Stryng Text
          | List (V.Vector Type)
          | Struct [Type]
          -- TODO(tim): Make the key type generic over hashable things.
          | Mapping (HM.HashMap Text Type)
  deriving (Eq, Show, Generic)

instance Ae.FromJSON Type where
  parseJSON (Ae.String s) = return . Stryng $ s
  parseJSON (Ae.Number x) = case floatingOrInteger x :: Either Double Integer of
                                Left f -> fail $ "must be int or string: " ++ show f
                                Right n -> return . Number $ n
  parseJSON (Ae.Array as) = List <$> V.mapM Ae.parseJSON as
  parseJSON (Ae.Object ss) = let a `cmp` b = fst a `compare` fst b
                             in Struct <$> (mapM (Ae.parseJSON . snd) . List.sortBy cmp . HM.toList $ ss)
  parseJSON (Ae.Bool b) = return . Number $ if b then 1 else 0
  parseJSON _ = fail "unknown aeson type"

-- This is a clumsy hack to just create a mapping(bytes32 => uint),
-- and probably needs to be replaced with something more generic.
-- For example, this prohibits mapping(address => mapping(address => bool)),
-- both because it only uses a string key and because the values is not Type2
data TypeHashMap = Type Type | MappingHashMap (HM.HashMap Text Type) deriving (Eq, Show, Generic)

toType :: TypeHashMap -> Type
toType (Type t) = t
toType (MappingHashMap hm) = Mapping hm

instance Ae.FromJSON TypeHashMap where
  parseJSON (Ae.Object ss) = MappingHashMap <$> traverse Ae.parseJSON ss
  parseJSON v = Type <$> Ae.parseJSON v


newtype Records = Records [[Type]] deriving (Eq, Show, Generic)
instance Ae.FromJSON Records

newtype RecordsHashMap = RecordsHashMap [[TypeHashMap]] deriving (Eq, Show, Generic)
instance Ae.FromJSON RecordsHashMap

equalChunksOf :: Int -> [Word8] -> [[Word8]]
equalChunksOf n ws | length ws == 0 = []
                   | length ws <= n = [ws ++ replicate (n - length ws) 0]
                   | otherwise = let (car, cdr) = splitAt n ws
                                 in car : (equalChunksOf n cdr)

hash :: Word256 -> Word256
hash = fastBytesToWord256 . keccak256 . fastWord256ToBytes

encodeSequentially :: Word256 -> [Type] -> ([(Word256, Word256)], Word256)
encodeSequentially k [] = ([], k)
encodeSequentially k (t:ts) =
  let (tSlots, k') = encodeType k t
      (tsSlots, k'') = encodeSequentially k' ts
  in (tSlots ++ tsSlots, k'')

mapHash :: Word256 -> Word256 -> Word256
mapHash x y = fastBytesToWord256 . keccak256 $ fastWord256ToBytes x <> fastWord256ToBytes y

-- First return value is the slots for this value, and the second return value
-- is the next available slot.
encodeType :: Word256 -> Type -> ([(Word256, Word256)], Word256)
encodeType k (Number n) | n >= 0 && n <= (2 ^ (256 :: Integer)) = ([(k, fromIntegral n)], k + 1)
                        | otherwise = error "unimplemented for negative numbers"
encodeType k (Stryng s) =
  if length payload < 32
      then let pad = replicate (31 - length payload) 0
               size = [fromIntegral $ length payload `shiftL` 1]
           in ([(k, bytesToWord256 $ payload ++ pad ++ size)], k+1)
      else let size = fromIntegral $ (length payload `shiftL` 1) .|. 1
               pointer = (k, size)
               start = hash k
               packets = zip (map (start+) [0..]) . map bytesToWord256 . equalChunksOf 32 $ payload
           in (pointer:packets, k + 1)
  where payload = BS.unpack . encodeUtf8 $ s
encodeType k (List payload) =
  let size = fromIntegral . length $ payload
      pointer = (k, size)
      start = hash k
      (packets, _) = encodeSequentially start (V.toList payload)
  in (pointer:packets, k + 1)
encodeType k (Struct ts) = encodeSequentially k ts
encodeType p (Mapping hm) =
  let pointer = (p, 0)
      -- This is very specific to the case of using bytes32 as keys.
      -- Using strings as key hashes the whole string, rather than
      -- slicing to 32 bytes and extending by 0s.
      payload s = let raw = BS.unpack . encodeUtf8 $ s
                  in if length raw < 33
                        then raw ++ replicate (32 - length raw) 0
                        else take 32 raw
      -- For a mapping value located in contract slot p with key s
      -- the slot is keccak256(s <> p)
      trieKey s = mapHash (bytesToWord256 . payload $ s) p
      place (s, v) = fst . encodeType (trieKey s) $ v
  in (pointer:(concatMap place . HM.toList $ hm), p+1)

encodeRecord :: Word256 -> [Type] -> [(Word256, Word256)]
encodeRecord k = fst . encodeSequentially k

encodeAllRecords :: Records -> [[(Word256, Word256)]]
encodeAllRecords (Records recs) = map (encodeRecord 0) recs


encodeJSON :: L.ByteString -> [[(Word256, Word256)]]
encodeJSON = encodeAllRecords . Records . JS.parseLazyByteString (JS.arrayOf JS.value)

insertContractsCount :: Int -> Text -> Text -> BS.ByteString -> Address -> GenesisInfo -> GenesisInfo
insertContractsCount n name src code start gi = insertContracts (replicate n []) name src code start gi

insertContractsJSON :: L.ByteString -> Text -> Text -> BS.ByteString -> Address -> GenesisInfo -> GenesisInfo
insertContractsJSON rawJSON name src code start gi = insertContracts (encodeJSON rawJSON) name src code start gi

encodeAllRecordsHashMaps :: RecordsHashMap -> [[(Word256, Word256)]]
encodeAllRecordsHashMaps (RecordsHashMap recs) = encodeAllRecords . Records . map (map toType) $ recs

encodeJSONHashMaps :: L.ByteString -> [[(Word256, Word256)]]
encodeJSONHashMaps = encodeAllRecordsHashMaps . RecordsHashMap . JS.parseLazyByteString (JS.arrayOf JS.value)

insertContractsJSONHashMaps :: L.ByteString -> Text -> Text -> BS.ByteString -> Address -> GenesisInfo -> GenesisInfo
insertContractsJSONHashMaps rawJSON name src code start gi = insertContracts (encodeJSONHashMaps rawJSON) name src code start gi

insertContracts :: [[(Word256, Word256)]] -> Text -> Text -> BS.ByteString -> Address -> GenesisInfo -> GenesisInfo
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
         genesisInfoCodeInfo = initialCode ++ [CodeInfo decoded src name]}

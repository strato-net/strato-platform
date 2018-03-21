{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Generation (
  encodeAllTypes,
  insertContracts,
  parseTypes,
  Type(..)
) where

import Data.Bifunctor (bimap)
import Data.Bits
import Data.ByteString hiding (map, count, zip, concat, length, replicate)
import qualified Data.ByteString as BS
import qualified Data.ByteString.UTF8 as U8
import qualified Data.ByteString.Base16 as B16
import Data.List.Split (splitOn)
import qualified Data.Map as Map
import Text.Read (readMaybe)

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.SHA
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Data.GenesisInfo

data Type = Number Integer | Stryng String
  deriving (Eq, Show)

parseType :: String -> Type
parseType inp = case readMaybe inp :: Maybe Integer of
                    Just n -> Number n
                    _ -> case readMaybe inp :: Maybe String of
                            Just s -> Stryng s
                            _ -> error $ "invalid type: " ++ inp

parseTypes :: String -> Map.Map Int Type
parseTypes = Map.fromList . zip [0..] . map parseType . splitOn ","

convert :: (Integral a, Integral b) => (a, b) -> (Word256, Word256)
convert = bimap fromIntegral fromIntegral

encodeType :: Int -> Type -> Either String [(Word256, Word256)]
encodeType k (Number n) | n >= 0 && n <= (2 ^ (256 :: Integer)) = Right [convert (k, n)]
                        | otherwise = Left "unimplemented for negative numbers"
encodeType k (Stryng s) =
    let upper = BS.unpack . U8.fromString $ s
        mid = replicate (31 - length upper) 0
        low = [fromIntegral $ length upper `shiftL` 1]
    in if length upper > 31
          then Left "unimplemented for strings > 31 bytes"
          else Right [(fromIntegral k, bytesToWord256 $ upper ++ mid ++ low)]

encodeAllTypes :: Map.Map Int Type -> Either String [(Word256, Word256)]
encodeAllTypes i = concat <$> (sequence . Map.foldWithKey (\k a ws -> encodeType k a : ws) [] $ i)

insertContracts :: String -> ByteString -> Address -> Integer -> GenesisInfo -> GenesisInfo
insertContracts src code start count gi =
  let initialAccounts = genesisInfoAccountInfo gi
      initialCode = genesisInfoCodeInfo gi
      (decoded, extra) = B16.decode code
      codeHash = if extra /= "" && extra /= "\n"
                   then error ("bytecode not encoded in base16:" ++ show code)
                   else superProprietaryStratoSHAHash decoded
      rng = [toInteger start..(toInteger start) + count - 1]
      -- TODO(tim): populate the initial storage
      mkContract addr = Contract addr 0 codeHash []
      range = map fromInteger rng
  in gi {genesisInfoAccountInfo = initialAccounts ++ map mkContract range,
         genesisInfoCodeInfo = initialCode ++ [CodeInfo decoded src]}

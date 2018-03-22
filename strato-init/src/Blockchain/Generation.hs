{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Generation (
  encodeAllTypes,
  insertContractsCount,
  insertContractsCSV,
  insertContracts,
  parseTypes,
  Type(..)
) where

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

parseType :: String -> Either String Type
parseType inp = case readMaybe inp :: Maybe Integer of
                    Just n -> Right $ Number n
                    _ -> case readMaybe inp :: Maybe String of
                            Just s -> Right $ Stryng s
                            _ -> Left $ "invalid type: " ++ inp

parseTypes :: String -> Either String (Map.Map Int Type)
parseTypes line = do
  let wyrds = splitOn "," line
  types <- mapM parseType wyrds
  return . Map.fromList . zip [0..] $ types

encodeType :: Int -> Type -> Either String [(Word256, Word256)]
encodeType k (Number n) | n >= 0 && n <= (2 ^ (256 :: Integer)) = Right [(fromIntegral k, fromIntegral n)]
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


insertContractsCount :: Int -> String -> ByteString -> Address -> GenesisInfo -> Either String GenesisInfo
insertContractsCount n src code start gi = return $ insertContracts (replicate n []) src code start gi

insertContractsCSV :: [String] -> String -> ByteString -> Address -> GenesisInfo -> Either String GenesisInfo
insertContractsCSV lynes src code start gi = do
  types <- mapM parseTypes lynes
  recs <- mapM encodeAllTypes types
  return $ insertContracts recs src code start gi

insertContracts :: [[(Word256, Word256)]] -> String -> ByteString -> Address -> GenesisInfo -> GenesisInfo
insertContracts recs src code start gi =
  let initialAccounts = genesisInfoAccountInfo gi
      initialCode = genesisInfoCodeInfo gi
      (decoded, extra) = B16.decode code
      codeHash = if extra /= "" && extra /= "\n"
                   then error ("bytecode not encoded in base16:" ++ show code)
                   else superProprietaryStratoSHAHash decoded
      mkContract (addr, slots) = Contract addr 0 codeHash slots
      addrs = map (start+) [0..]
      addrsAndSlots = zip addrs recs
  in gi {genesisInfoAccountInfo = initialAccounts ++ map mkContract addrsAndSlots,
         genesisInfoCodeInfo = initialCode ++ [CodeInfo decoded src]}

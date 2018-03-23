{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Generation (
  encodeAllTypes,
  encodeCSV,
  insertContractsCount,
  insertContractsCSV,
  insertContracts,
  parseTypes,
  Type(..)
) where

import Data.Bifunctor (first)
import Data.Bits
import Data.ByteString hiding (map, count, zip, concat, length, replicate)
import qualified Data.ByteString as BS
import qualified Data.ByteString.UTF8 as U8
import qualified Data.ByteString.Base16 as B16
import qualified Data.Map as Map
import Text.CSV
import Text.Read (readMaybe)

import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.SHA
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Data.GenesisInfo

import Debug.Trace

data Type = Number Integer | Stryng String
  deriving (Eq, Show)

parseType :: String -> Either String Type
parseType inp = case readMaybe inp :: Maybe Integer of
                    Just n -> Right $ Number n
                    Nothing -> case readMaybe inp :: Maybe String of
                                   Just s -> Right $ Stryng s
                                   _ -> Left $ "invalid type: " ++ inp

parseTypes :: Record -> Either String (Map.Map Int Type)
parseTypes fields = do
  let fs = trace (show fields) fields
  types <- mapM parseType fs
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

encodeCSV :: String -> Either String [[(Word256, Word256)]]
encodeCSV rawCSV = do
  recs <- first show . parseCSV "__records_file" $ rawCSV
  types <- trace (show recs) $ mapM parseTypes recs
  mapM encodeAllTypes . trace (show types) $ types

insertContractsCount :: Int -> String -> ByteString -> Address -> GenesisInfo -> Either String GenesisInfo
insertContractsCount n src code start gi = return $ insertContracts (replicate n []) src code start gi


insertContractsCSV :: String -> String -> ByteString -> Address -> GenesisInfo -> Either String GenesisInfo
insertContractsCSV rawCSV src code start gi = do
  slotss <- encodeCSV rawCSV
  return $ insertContracts slotss src code start gi

insertContracts :: [[(Word256, Word256)]] -> String -> ByteString -> Address -> GenesisInfo -> GenesisInfo
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

{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
module Handler.BatchTransactionResult where

import           Blockchain.SHA
import           Data.Aeson
import qualified Data.Map.Strict as M
import qualified Data.Text       as T
import           Handler.Common
import           Import
import           Numeric         (readHex)
import qualified Prelude         as P

data StrungSHA = StrungSHA { unStrungSHA :: SHA }
    deriving (Eq, Ord, Read, Show)

instance FromJSON StrungSHA where
    parseJSON (String s) = case readHex $ T.unpack s of
        [(x, "")] -> return . StrungSHA $ SHA x
        _         -> fail "Expected a hex string of 32 bytes"
    parseJSON _ = fail "Expected a String containing a SHA"

instance ToJSON StrungSHA where
    toJSON = String . T.pack . formatSHAWithoutColor . unStrungSHA

instance (ToJSON v) => ToJSON (Map StrungSHA v) where
    toJSON = object . fmap toPairs . M.toList
        where asKey x = let (String s) = toJSON x in s
              toPairs (k, v) = asKey k .= toJSON v

postBatchTransactionResultR :: Handler Value
postBatchTransactionResultR = do
  addHeader "Access-Control-Allow-Origin" "*"
  hashesR <- parseJsonBody :: Handler (Result [StrungSHA])
  case hashesR of
    Success hashes -> do
        txrs <- runDB $ selectList [ TransactionResultTransactionHash <-. (unStrungSHA <$> hashes) ] [] :: Handler [Entity TransactionResult]
        let mmUpsert k v m = case M.lookup k m of
                Nothing -> M.insert k [v] m
                Just vs -> M.insert k (v:vs) m
            theFold m v = mmUpsert (StrungSHA $ transactionResultTransactionHash v) v m
            baseMap = P.foldl (\m k -> M.insert k [] m) M.empty hashes
            grouped = P.foldl theFold baseMap (entityVal <$> txrs)
        returnJson grouped
    x -> invalidArgs [T.pack $ "couldn't decode array of transaction hashes " ++ show x]




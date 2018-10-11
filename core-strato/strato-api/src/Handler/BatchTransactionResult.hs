{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
module Handler.BatchTransactionResult where

import           Blockchain.SHA
import           Data.Aeson
import           Data.Aeson.Encoding
import qualified Data.Map.Strict     as M
import qualified Data.Text           as T
import qualified Database.Esqueleto  as E
import           Handler.Common
import           Handler.Filters              (fromHexText)
import           Import
import           Numeric             (readHex)
import qualified Prelude             as P

data StrungSHA = StrungSHA { unStrungSHA :: SHA }
    deriving (Eq, Ord, Read, Show)

instance FromJSON StrungSHA where
    parseJSON (String s) = case readHex $ T.unpack s of
        [(x, "")] -> return . StrungSHA $ SHA x
        _         -> fail "Expected a hex string of 32 bytes"
    parseJSON _ = fail "Expected a String containing a SHA"

instance ToJSON StrungSHA where
    toJSON = String . T.pack . formatSHAWithoutColor . unStrungSHA

instance ToJSONKey StrungSHA where
    toJSONKey = ToJSONKeyText f (text . f)
      where f = T.pack . formatSHAWithoutColor . unStrungSHA

postBatchTransactionResultR :: Handler Value
postBatchTransactionResultR = do
  addHeader "Access-Control-Allow-Origin" "*"
  chainId <- fmap (fmap fromHexText) $ lookupGetParam "chainid"
  hashesR <- parseJsonBody :: Handler (Result [StrungSHA])
  case hashesR of
    Success hashes -> do
        txrs <- runDB . E.select . E.from $ \txr -> do
          let matchHashes = (txr E.^. TransactionResultTransactionHash) `E.in_` E.valList (unStrungSHA <$> hashes)
              matchChainId = case chainId of
                Nothing -> (E.isNothing $ txr E.^. TransactionResultChainId)
                Just cid -> (txr E.^. TransactionResultChainId) E.==. (E.just $ E.val cid)
          E.where_ (matchHashes E.&&. matchChainId)
          return txr
        let mmUpsert k v m = case M.lookup k m of
                Nothing -> M.insert k [v] m
                Just vs -> M.insert k (v:vs) m
            theFold m v = mmUpsert (StrungSHA $ transactionResultTransactionHash v) v m
            baseMap = P.foldl (\m k -> M.insert k [] m) M.empty hashes
            grouped = P.foldl theFold baseMap (E.entityVal <$> txrs)
        returnJson grouped
    x -> invalidArgs [T.pack $ "couldn't decode array of transaction hashes " ++ show x]




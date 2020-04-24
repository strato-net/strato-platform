{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Handlers.BatchTransactionResult (
  API,
  server
  ) where


import           Control.Monad
import           Control.Monad.IO.Class
import           Data.Aeson
import           Data.Aeson.Encoding
import qualified Data.Map.Strict     as M
import qualified Data.Text           as T
import qualified Database.Esqueleto  as E
import           Database.Persist.Postgresql
import           Numeric             (readHex)
import           Servant

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.SHA

import           SQLM



type API = 
  "transactionResult" :> "batch" :> ReqBody '[JSON,PlainText] [StrungSHA]
                                 :> Post '[JSON] Value

server :: ConnectionPool -> Server API
server connStr = postBatchTransactionResult connStr

---------------------------

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

instance MimeUnrender PlainText [StrungSHA] where
  mimeUnrender _ = maybe (Left "Couldn't decode [Keccak256]") Right . decode

postBatchTransactionResult :: ConnectionPool -> [StrungSHA] -> Handler Value
postBatchTransactionResult pool hashes = do

  when (null hashes) $ throwError err400{ errBody="missing parameter: hashes" }
  
--  hashesR <- parseJsonBody :: HandlerFor App (Result [StrungSHA])
  txrs <- liftIO $ runSQLM pool $ sqlQuery . E.select . E.from $ \txr -> do
    let matchHashes = (txr E.^. TransactionResultTransactionHash) `E.in_` E.valList (unStrungSHA <$> hashes)
    E.where_ matchHashes
    return txr
  let mmUpsert k v m = case M.lookup k m of
                Nothing -> M.insert k [v] m
                Just vs -> M.insert k (v:vs) m
      theFold m v = mmUpsert (StrungSHA $ transactionResultTransactionHash v) v m
      baseMap = foldl (\m k -> M.insert k [] m) M.empty hashes
      grouped = foldl theFold baseMap (E.entityVal <$> txrs)
  return . toJSON $ grouped





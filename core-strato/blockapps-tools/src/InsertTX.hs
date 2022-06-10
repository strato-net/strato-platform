{-# LANGUAGE OverloadedStrings #-}

module InsertTX where

import           Control.Monad
import           Blockchain.Output
import qualified Data.Binary                  as BN
import qualified Data.ByteString              as B
import qualified Data.ByteString.Lazy         as BL
import           Data.Time.Clock
import qualified Database.Persist.Postgresql  as SQL
import           System.FilePath

import           Blockchain.Data.Transaction
import           Blockchain.Data.TXOrigin
import           Blockchain.DB.SQLDB          (runSqlPool, createPostgresqlPool)
import           Blockchain.EthConf
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.Secp256k1

retrievePrvKey :: FilePath -> IO (Maybe PrivateKey)
retrievePrvKey filePath = do
    keyBytes <- BL.readFile filePath
    return $ importPrivateKey $ BN.decode keyBytes

insertTX :: IO ()
insertTX = do
  Just prvKey <- retrievePrvKey $ "config" </> "priv"
  theTime <- getCurrentTime
  db <- runNoLoggingT $ createPostgresqlPool connStr 20
  tx <- createContractCreationTX 0 1 1000000 0 (Code $ B.pack [0x60, 0, 0x56]) Nothing prvKey
  flip runSqlPool db $ void $ SQL.insert (txAndTime2RawTX Direct tx (-1) theTime)

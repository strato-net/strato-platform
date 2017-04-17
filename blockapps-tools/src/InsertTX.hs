{-# LANGUAGE OverloadedStrings #-}

module InsertTX where

import           Control.Monad
import           Control.Monad.Logger
import           Control.Monad.Trans.Resource
import qualified Data.Binary                  as BN
import qualified Data.ByteString              as B
import qualified Data.ByteString.Lazy         as BL
import           Data.Time.Clock
import qualified Database.Persist.Postgresql  as SQL
import qualified Network.Haskoin.Crypto       as H
import           System.FilePath

import           Blockchain.Data.Code
import           Blockchain.Data.Transaction
import           Blockchain.Data.TXOrigin
import           Blockchain.DB.SQLDB          (createPostgresqlPool')
import           Blockchain.EthConf

retrievePrvKey :: FilePath -> IO (Maybe H.PrvKey)
retrievePrvKey filePath = do
    keyBytes <- BL.readFile filePath
    return $ H.makePrvKey $ BN.decode keyBytes

insertTX :: IO ()
insertTX = do
  Just prvKey <- retrievePrvKey $ "config" </> "priv"
  theTime <- getCurrentTime
  db <- runNoLoggingT $ createPostgresqlPool' connStr 20
  tx <- H.withSource H.devURandom $ createContractCreationTX 0 1 1000000 0 (Code $ B.pack [0x60, 0, 0x56]) prvKey
  runResourceT $ flip SQL.runSqlPool db $ void $ SQL.insert (txAndTime2RawTX Direct tx (-1) theTime)

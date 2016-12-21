{-# LANGUAGE OverloadedStrings #-}

module InsertTX where

import Control.Monad.Logger
import Control.Monad.Trans.Resource
import qualified Data.Binary as BN
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Time.Clock
import qualified Database.Persist.Postgresql as SQL
import qualified Network.Haskoin.Crypto as H
import System.FilePath

import Blockchain.Data.Code
import Blockchain.Data.RawTransaction
import Blockchain.Data.Transaction
import Blockchain.Data.TXOrigin
import Blockchain.EthConf


--Just prvKey = H.makePrvKey 0xabcd

retrievePrvKey :: FilePath -> IO (Maybe H.PrvKey)
retrievePrvKey path = do
    keyBytes <- BL.readFile path
    return $ H.makePrvKey $ BN.decode keyBytes


insertTX::IO ()
insertTX = do
  Just prvKey <- retrievePrvKey $ "config" </> "priv"
  theTime <- getCurrentTime
  db <- runNoLoggingT $ SQL.createPostgresqlPool connStr' 20
  tx <- H.withSource H.devURandom $ createContractCreationTX 0 1 1000000 0 (Code $ B.pack [0x60, 0, 0x56]) prvKey
  --let tx = createMessageTX 0 1 1000000 (Address 0xabcd) 1 "" prvKey
  runResourceT $ flip SQL.runSqlPool db $ do
                        SQL.insert (txAndTime2RawTX Direct tx (-1) theTime)
                        return ()


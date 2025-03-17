{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.LogDB
  ( HasMemLogDB (..),
    putLogDB,
    putLogDBs,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Data.Aeson hiding (Key)
import qualified Database.Persist.Postgresql as SQL
import Numeric

class (Monad m) => HasMemLogDB m where
  enqueueLogEntries :: [LogDB] -> m ()
  flushLogEntries :: m ()

  enqueueLogEntry :: LogDB -> m ()
  enqueueLogEntry = enqueueLogEntries . pure

putLogDB :: HasSQLDB m => LogDB -> m (Key LogDB)
putLogDB = fmap head . putLogDBs . pure

putLogDBs :: HasSQLDB m => [LogDB] -> m [Key LogDB]
putLogDBs = sqlQuery . SQL.insertMany

instance ToJSON LogDB where
  toJSON
    ( LogDB
        bh
        th
        x
        maybeTopic1
        maybeTopic2
        maybeTopic3
        maybeTopic4
        dataBS
        bloomW512
      ) =
      object $
        [ "hash" .= th,
          "blockHash" .= bh,
          "address" .= x,
          "topic1" .= (maybe "" showHexSimple maybeTopic1 :: String),
          "topic2" .= (maybe "" showHexSimple maybeTopic2 :: String),
          "topic3" .= (maybe "" showHexSimple maybeTopic3 :: String),
          "topic4" .= (maybe "" showHexSimple maybeTopic4 :: String),
          "data" .= dataBS,
          "bloom" .= showHexSimple bloomW512
        ]

showHexSimple :: (Integral a) => a -> String
showHexSimple t = showHex t ""


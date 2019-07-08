{-# LANGUAGE EmptyDataDecls             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE FlexibleInstances          #-}
{-# LANGUAGE GADTs                      #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE QuasiQuotes                #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}

module Blockchain.Data.RawTransaction (
  RawTransaction(..),
  insertRawTX,
  insertRawTX'
  ) where


import           UnliftIO.Exception
import           Control.Monad
import           Control.Monad.Change.Modify  (Accessible(..), Proxy(..))
import           Control.Monad.IO.Class
import           Control.Monad.IO.Unlift
import           Control.Monad.Trans.Reader
import           Control.Monad.Trans.Resource
import qualified Database.Persist.Postgresql  as SQL

import           Blockchain.Data.DataDefs
import           Blockchain.DB.SQLDB
import           Blockchain.DBM


insertRawTX :: HasSQLDB m => DebugMode -> [RawTransaction] -> m ()
insertRawTX m rawTXs = do
  db <- access Proxy
  runResourceT $ SQL.runSqlPool (insertRawTX' m rawTXs) db


insertRawTX' :: MonadUnliftIO m =>
             DebugMode -> [RawTransaction] -> ReaderT (SQL.PersistEntityBackend RawTransaction) m ()
insertRawTX' mode rawTXs =
  forM_ rawTXs $ \rawTX -> do
    ret <- try $ SQL.insertBy rawTX
    case ret of
     Left e -> liftIO $ (if mode == Log then putStrLn else error) $ "TX already inserted: " ++ show (e::SomeException)
     Right _ -> return ()

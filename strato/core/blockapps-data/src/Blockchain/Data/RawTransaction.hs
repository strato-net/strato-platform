{-# LANGUAGE EmptyDataDecls #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeFamilies #-}

module Blockchain.Data.RawTransaction
  ( RawTransaction (..),
    insertRawTX,
    insertRawTX',
  )
where

import Blockchain.DB.SQLDB
import Blockchain.DBM
import Blockchain.Data.DataDefs
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.IO.Unlift
import Control.Monad.Trans.Reader
import qualified Database.Persist.Postgresql as SQL
import UnliftIO.Exception

insertRawTX :: HasSQLDB m => DebugMode -> [RawTransaction] -> m ()
insertRawTX m rawTXs = sqlQuery $ insertRawTX' m rawTXs

insertRawTX' ::
  MonadUnliftIO m =>
  DebugMode ->
  [RawTransaction] ->
  ReaderT (SQL.PersistEntityBackend RawTransaction) m ()
insertRawTX' mode rawTXs =
  forM_ rawTXs $ \rawTX -> do
    ret <- try $ SQL.insertBy rawTX
    case ret of
      Left e -> liftIO $ (if mode == Log then putStrLn else error) $ "TX already inserted: " ++ show (e :: SomeException)
      Right _ -> return ()

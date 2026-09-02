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
import qualified Data.Map.Strict as M
import qualified Data.Set as S
import qualified Database.Persist.Postgresql as SQL
import UnliftIO.Exception

insertRawTX :: HasSQLDB m => DebugMode -> [RawTransaction] -> m ()
insertRawTX m rawTXs = sqlQuery $ insertRawTX' m rawTXs

insertRawTX' ::
  MonadUnliftIO m =>
  DebugMode ->
  [RawTransaction] ->
  ReaderT (SQL.PersistEntityBackend RawTransaction) m ()
insertRawTX' mode rawTXs = do
  let uniqueTransactions =
        M.fromListWith
          (\_ existing -> existing)
          [(rawTransactionTxHash rawTX, rawTX) | rawTX <- rawTXs]
      transactionHashes = M.keys uniqueTransactions
  existingTransactions <-
    if null transactionHashes
      then pure []
      else SQL.selectList [RawTransactionTxHash SQL.<-. transactionHashes] []
  let existingHashes =
        S.fromList $ rawTransactionTxHash . SQL.entityVal <$> existingTransactions
      missingTransactions =
        [ rawTX
        | (txHash, rawTX) <- M.toList uniqueTransactions,
          txHash `S.notMember` existingHashes
        ]
  forM_ (chunksOf 1000 missingTransactions) $ \chunk -> do
    result <- try $ SQL.insertMany_ chunk
    case result of
      Left e -> liftIO $ (if mode == Log then putStrLn else error) $ "TX insert failed: " ++ show (e :: SomeException)
      Right _ -> pure ()
  where
    chunksOf _ [] = []
    chunksOf size values =
      let (chunk, rest) = splitAt size values
       in chunk : chunksOf size rest

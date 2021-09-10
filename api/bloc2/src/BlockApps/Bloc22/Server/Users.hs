{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE TemplateHaskell     #-}

module BlockApps.Bloc22.Server.Users (
  postUsersFill
--  getBlocTransactionResult,
--  postBlocTransactionResults,
--  getBatchBlocTransactionResult',
--  getBlocTransactionResult',
--  postUsersFill,
--  forStateT,
--  constructArgValuesAndSource,
--  recurseTRDs,
--  TRD(..),
  ) where

import           Control.Monad
import           Control.Monad.Except
import qualified Data.Aeson                        as Aeson
import qualified Data.ByteString.Lazy              as BL
import           Data.Int                          (Int32)
import qualified Data.Text.Encoding                as Text
import           Opaleye                           hiding (not, null, index, max)
import           UnliftIO

import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Database.Tables
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.TransactionResult
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Logging
import           BlockApps.Solidity.Contract()
import qualified BlockApps.Strato.Types            as Deprecated
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Keccak256
import           Control.Monad.Composable.BlocSQL
import           Control.Monad.Composable.CoreAPI
import           Control.Monad.Composable.SQL
import           Handlers.AccountInfo
import           Handlers.Faucet
import           SQLM


postUsersFill :: (HasCoreAPI m, HasBlocSQL m, MonadLogger m, HasSQL m, HasBlocEnv m) =>
                 UserName  -> Address -> Bool -> m BlocTransactionResult
postUsersFill _ addr resolve = do
  shouldPost <- fmap gasOn getBlocEnv
  if shouldPost
    then blocTransaction $ do
      when resolve ($logInfoS "postUsersFill" "Waiting for faucet transaction to be mined")
      hashes <- blocStrato $ postFaucetClient addr
      void . blocModify $ \conn -> runInsertMany conn hashNameTable [
        ( Nothing
        , constant h
        , constant (0 :: Int32)
        , constant (0 :: Int32)
        , constant (Text.decodeUtf8 . BL.toStrict $ Aeson.encode Deprecated.defaultPostTx{Deprecated.posttransactionTo = Just addr})
        ) | h <- hashes]
      result <- getBlocTransactionResult' hashes resolve
      when (resolve && Success == blocTransactionStatus result) $ do
        waitForBalance addr
      $logInfoLS "postUsersFill/resolve" resolve
      $logInfoLS "postUsersFill/result" result
      when (Failure == blocTransactionStatus result) $
        throwIO $ UnavailableError "faucet transaction failed; please try again"
      return result
    else pure $ BlocTransactionResult Success zeroHash Nothing Nothing

waitForBalance :: (MonadIO m, MonadLogger m,  HasCoreAPI m) => Address -> m ()
waitForBalance addr = waitFor "no user account found" go
  where go :: (MonadIO m, MonadLogger m, HasCoreAPI m) => m Bool
        go = do
          let params = accountsFilterParams{qaAddress = Just addr, qaMinBalance = Just 1}
          accts <- blocStrato $ getAccountsFilter params
          $logInfoLS "waitForBalance/req" params
          $logInfoLS "waitForBalance/resp" accts
          return . not $ null accts


{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeOperators       #-}

module Bloc.Server.Users (
  postUsersFill
  ) where

import           Control.Lens
import           Control.Monad
import qualified Control.Monad.Change.Alter        as A
import           Data.Source.Map                   (SourceMap)
import           UnliftIO

import           Bloc.API.Users
import           Bloc.API.Utils
import           Bloc.Monad
import           Bloc.Server.TransactionResult
import           Bloc.Server.Utils
import           BlockApps.Logging
import           BlockApps.Solidity.Contract()
import           Blockchain.Data.AddressStateDB
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Keccak256
import           Bloc.Server.BlocOptions
import           Control.Monad.Composable.SQL
import           Handlers.AccountInfo
import           Handlers.Faucet
import           SQLM


postUsersFill :: ( A.Selectable Account AddressState m
                 , (Keccak256 `A.Selectable` SourceMap) m
                 , MonadLogger m
                 , HasSQL m
                 , HasBlocEnv m
                 )
              => JwtToken  -> Address -> Bool -> m BlocTransactionResult
postUsersFill _ addr resolve = do
  shouldPost <- fmap gasOn getBlocEnv
  if shouldPost
    then do
      when resolve ($logInfoS "postUsersFill" "Waiting for faucet transaction to be mined")
      hashes <- postFaucet addr
      result <- getBlocTransactionResult' hashes resolve
      when (resolve && Success == blocTransactionStatus result) $ do
        waitForBalance addr
      $logInfoLS "postUsersFill/resolve" resolve
      $logInfoLS "postUsersFill/result" result
      when (Failure == blocTransactionStatus result) $
        throwIO $ UnavailableError "faucet transaction failed; please try again"
      return result
    else do
    if flags_useDeprecatedFillFailBehavior
      then pure $ BlocTransactionResult Success zeroHash Nothing Nothing
      else throwIO $ UserError "the '/fill' route doesn't work when the 'gasOn' flag has been set to false."

waitForBalance :: (MonadLogger m, HasSQL m) => Address -> m ()
waitForBalance addr = waitForWithTimeout "no user account found" go
  where go :: (MonadLogger m, HasSQL m) => m (Bool, ())
        go = do
          let params = accountsFilterParams & qaAddress ?~ addr & qaMinBalance ?~ 1
          accts <- getAccount' params
          $logInfoLS "waitForBalance/req" params
          $logInfoLS "waitForBalance/resp" accts
          return (not $ null accts, ())


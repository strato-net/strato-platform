{-# LANGUAGE FlexibleContexts    #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeOperators       #-}

module BlockApps.Bloc22.Server.Users (
  postUsersFill
  ) where

import           Control.Lens
import           Control.Monad
import qualified Control.Monad.Change.Alter        as A
import           Control.Monad.Except
import           Data.Source.Map                   (SourceMap)
import           UnliftIO

import           BlockApps.Bloc22.API.Users
import           BlockApps.Bloc22.API.Utils
import           BlockApps.Bloc22.Monad
import           BlockApps.Bloc22.Server.TransactionResult
import           BlockApps.Bloc22.Server.Utils
import           BlockApps.Logging
import           BlockApps.Solidity.Contract()
import           Blockchain.Data.AddressStateDB
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Keccak256
import           BlockApps.Bloc22.Server.BlocOptions
import           Control.Monad.Composable.BlocSQL
import           Control.Monad.Composable.CoreAPI
import           Control.Monad.Composable.SQL
import           Handlers.AccountInfo
import           Handlers.Faucet
import           SQLM


postUsersFill :: ( HasCoreAPI m
                 , A.Selectable Account AddressState m
                 , (Keccak256 `A.Alters` SourceMap) m
                 , HasBlocSQL m
                 , MonadLogger m
                 , HasSQL m
                 , HasBlocEnv m
                 )
              => UserName  -> Address -> Bool -> m BlocTransactionResult
postUsersFill _ addr resolve = do
  shouldPost <- fmap gasOn getBlocEnv
  if shouldPost
    then blocTransaction $ do
      when resolve ($logInfoS "postUsersFill" "Waiting for faucet transaction to be mined")
      hashes <- blocStrato $ postFaucetClient addr
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

waitForBalance :: (MonadIO m, MonadLogger m,  HasCoreAPI m) => Address -> m ()
waitForBalance addr = waitFor "no user account found" go
  where go :: (MonadIO m, MonadLogger m, HasCoreAPI m) => m Bool
        go = do
          let params = accountsFilterParams & qaAddress ?~ addr & qaMinBalance ?~ 1
          accts <- blocStrato $ getAccountsFilter params
          $logInfoLS "waitForBalance/req" params
          $logInfoLS "waitForBalance/resp" accts
          return . not $ null accts


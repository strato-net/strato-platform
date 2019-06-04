{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Strato23.Server.Password where

import           Control.Monad.IO.Class
import           Control.Monad.Reader
import           Data.IORef
import           Data.Text                        (Text)
import           Strato.Strato23.Monad

postPassword :: Text -> VaultM ()
postPassword password = do
  existingPassword <- asks superSecretPassword
  doIAlreadyHaveAPassword <- liftIO $ readIORef existingPassword
  case doIAlreadyHaveAPassword of
    Just _ -> return ()
    Nothing -> liftIO . atomicWriteIORef existingPassword $ Just password

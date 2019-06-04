{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Strato23.Server.Password where

import           Data.Maybe                       (fromMaybe, isJust)
import           Data.Text                        (Text)
import           Strato.Strato23.API
import           Strato.Strato23.Crypto
import           Strato.Strato23.Monad
import           Strato.Strato23.Database.Queries

postPassword :: Text -> VaultM ()
postPassword password = do
  existingPassword <- superSecretPassword <$> ask
  doIAlreadyHaveAPassword <- readIORef existingPassword
  case doIAlreadyHaveAPassword of
    Just _ -> return ()
    Nothing -> atomicWriteIORef existingPassword $ Just password

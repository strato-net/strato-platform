{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Strato.Strato23.Server.Ping (getPing) where

import Control.Monad.IO.Class (liftIO)
import Control.Monad.Reader (asks)
import Data.Aeson (encode, object, (.=))
import Data.IORef (readIORef)
import Data.Maybe (isJust)
import Strato.Strato23.API.Types
import Strato.Strato23.Monad
import UnliftIO (throwIO)

-- getPing returns the vault version number, and additionally verifies that the
-- vault password has been set. If the password is not set the endpoint fails
-- with HTTP 503 and a JSON body containing both the version and an error field
-- so it can be used as a readiness check.
getPing :: VaultM Version
getPing = do
  pwRef <- asks superSecretKey
  mKey <- liftIO $ readIORef pwRef
  if isJust mKey
    then return $ Version 1
    else
      throwIO . JsonError 503 . encode $
        object
          [ "version" .= (1 :: Int),
            "error" .= ("server password unset" :: String)
          ]

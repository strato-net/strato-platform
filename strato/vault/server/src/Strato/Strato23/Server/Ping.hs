{-# LANGUAGE DeriveGeneric #-}

module Strato.Strato23.Server.Ping (getPing) where

import           Strato.Strato23.Monad
import           Strato.Strato23.API.Types
import           Control.Monad.IO.Class
import           Data.ByteString.Char8  as BS
-- import           Data.Aeson
import           Data.Yaml              as Y
import           Debug.Trace
-- import           GHC.Generics

-- getPing will return the version of the vault found in the package.yaml file 
getPing :: VaultM Version
getPing = do
  packageYaml <- liftIO $ BS.readFile "../package.yaml"
  let parsedYaml = Y.decodeEither' packageYaml
  verson <- case parsedYaml of 
    Left err -> do
      traceM $ "There was an error trying to get the package.yaml file" <> show err
      pure $ "Unknown Version number"
    Right v -> pure $ version v
  -- packageYaml <- case (liftIO $ decodeFileEither "../package.yaml") of
  --   Left err -> do
  --     traceM $ "There was an error trying to get the package.yaml file: " <> show err
  --     pure $ "Unknown Version number"
  --   Right y -> do
  --     yy <- case y of
  --       Left err -> do
  --         traceM $ "There was an error trying to get the package.yaml file: " <> show err
  --         pure $ "Unknown Version number"
  --       right -> pure right
  --     verson <- parseEither (.: T.pack "version") yy

  return $ Version verson

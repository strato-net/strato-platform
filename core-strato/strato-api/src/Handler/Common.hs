{-# LANGUAGE FlexibleInstances #-}

module Handler.Common
  (
    module Handler.Common,
    module Blockchain.Data.DataDefs,
    module Blockchain.Data.Json
  )
where

import           Blockchain.Data.DataDefs
import           Blockchain.Data.Json
import           Import

-- We use this to throttle queries
myFetchLimit :: MonadIO m => m Int64
myFetchLimit = do
    settings <- liftIO $ loadYamlSettings [configSettingsYml] [] useEnv
    return (fromInteger $ appFetchLimit settings :: Int64)

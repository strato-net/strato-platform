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
import           Data.FileEmbed           (embedFile)
import           Import

-- These handlers embed files in the executable at compile time to avoid a
-- runtime dependency, and for efficiency.

getFaviconR :: Handler TypedContent
getFaviconR = return $ TypedContent "image/x-icon"
                     $ toContent $(embedFile "config/favicon.ico")

getRobotsR :: Handler TypedContent
getRobotsR = return $ TypedContent typePlain $ toContent $(embedFile "config/robots.txt")

-- We use this to throttle queries
fetchLimit :: Int64
fetchLimit = 100

--myFetchLimit :: IO (Int64)
--myFetchLimit = do
--	l <- getEnv "FETCH_LIMIT"
--	let ret = P.read l :: Int64
--	return $ ret

myFetchLimit :: IO (Int64)
myFetchLimit = do
    settings <- loadYamlSettings [configSettingsYml] [] useEnv
    return (fromInteger $ appFetchLimit settings :: Int64)

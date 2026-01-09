module Strato.Lite.Utils where

import Conduit
import Data.List (isPrefixOf)
import qualified Data.Text as T
import System.Directory
import System.FilePath

expandHome :: MonadIO m => FilePath -> m FilePath
expandHome path
  | "~/" `isPrefixOf` path = do
      home <- liftIO getHomeDirectory
      pure $ home </> drop 2 path
  | otherwise = pure path

resolvePath :: MonadIO m => FilePath -> m FilePath
resolvePath path = do
  expanded <- expandHome path
  if isAbsolute expanded
    then pure expanded
    else liftIO $ makeAbsolute expanded

getNodeDirectory :: MonadIO m => FilePath -> String -> String -> m FilePath
getNodeDirectory dir' network' nodeName = do
  dir <- resolvePath dir'
  pure $ dir </> network' </> nodeName

getLogsDirectory :: FilePath -> FilePath
getLogsDirectory = (</> "logs")

getLogs ::
  (MonadUnliftIO m, MonadThrow m) =>
  FilePath ->
  String ->
  String ->
  String ->
  Bool ->
  m ()
getLogs dir' network' name logFileName _ = do
  dir <- getNodeDirectory dir' network' name
  let logsDir = getLogsDirectory dir
      logFilePath = logsDir </> logFileName
  runConduitRes $ sourceFile logFilePath .| decodeUtf8C .| awaitForever (liftIO . putStr . T.unpack)

{-# LANGUAGE QuasiQuotes     #-}
{-# LANGUAGE LambdaCase      #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Logging
 ( LoggingT
 , runLoggingT
 , runNoLoggingT
 , formatLogOutput -- For testing
 ) where

import           Control.Concurrent     (ThreadId, myThreadId)
import           Control.Monad
import qualified Data.ByteString.Char8  as BC
import qualified Data.Text              as Text
import           System.GlobalLock
import           System.IO
import           System.Log.FastLogger  (fromLogStr)

import           Text.Printf

import           Data.Time
import           HFlags

import qualified Control.Monad.Logger as ML

defineEQFlag "minLogLevel" [| ML.LevelInfo :: ML.LogLevel |] "MINLOGLEVEL"  "Minimum log level to display"

type LoggingT = ML.LoggingT

runLoggingT :: LoggingT m a -> m a
runLoggingT = flip ML.runLoggingT commonLog

runNoLoggingT :: LoggingT m a -> m a
runNoLoggingT = flip ML.runLoggingT devNull

-------------------------------------------------

devNull :: ML.Loc -> ML.LogSource -> ML.LogLevel -> ML.LogStr -> IO ()
devNull _ _ _ _ = return ()

commonLog :: ML.Loc -> ML.LogSource -> ML.LogLevel -> ML.LogStr -> IO ()
commonLog loc logSource level msg = do
  when (level >= flags_minLogLevel) $ do
    myTID <- myThreadId
    timestamp <- getCurrentTime
    lock $ formatLogOutput timestamp myTID loc logSource level msg
    hFlush stdout

formatLogOutput :: PrintfType r
                => UTCTime
                -> ThreadId
                -> ML.Loc
                -> ML.LogSource
                -> ML.LogLevel
                -> ML.LogStr
                -> r
formatLogOutput timestamp tid loc logSource level msg =
  printf "[%-30s] %s%5s | %-14s | %-35s | %s" timestamp mLoc level tid logSource msg
   where mLoc = if (level == ML.LevelDebug || level == ML.LevelWarn) then printf "%50s | " loc else ""

instance PrintfArg UTCTime where
  formatArg = formatString . show

instance PrintfArg ML.LogLevel where
  formatArg = formatString . (\case
    ML.LevelDebug -> "DEBUG"
    ML.LevelInfo -> "INFO"
    ML.LevelWarn -> "WARN"
    ML.LevelError -> "ERROR"
    ML.LevelOther o -> Text.unpack o)

instance PrintfArg ThreadId where
  formatArg = formatString . show

instance PrintfArg ML.Loc where
  formatArg = formatString . (\ML.Loc{..} -> printf "%s:%d" loc_filename (fst loc_start) :: String)

instance PrintfArg ML.LogStr where
  formatArg = formatString . BC.unpack . fromLogStr

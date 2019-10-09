{-# LANGUAGE QuasiQuotes     #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Logging
 ( flags_minLogLevel
 , LoggingT
 , runLoggingT
 , runNoLoggingT
 , module Control.Monad.Logger
 , logDebugLS
 , logInfoLS
 , logWarnLS
 , logErrorLS
 , formatLogOutput -- For testing
 ) where

import           Control.Concurrent     (ThreadId, myThreadId)
import           Control.Monad
import qualified Data.ByteString.Char8  as BC
import qualified Data.Text              as Text
import           Language.Haskell.TH
import           Language.Haskell.TH.Syntax
import           System.GlobalLock
import           System.IO
import           System.Log.FastLogger  (fromLogStr)

import           Text.Printf

import           Data.Time
import           HFlags

import Control.Monad.Logger hiding (LoggingT, runLoggingT, runNoLoggingT)
import qualified Control.Monad.Logger as ML

defineEQFlag "minLogLevel" [| ML.LevelInfo :: LogLevel |] "MINLOGLEVEL"  "Minimum log level to display"

type LoggingT = ML.LoggingT

runLoggingT :: LoggingT m a -> m a
runLoggingT = flip ML.runLoggingT commonLog

runNoLoggingT :: LoggingT m a -> m a
runNoLoggingT = flip ML.runLoggingT devNull

-------------------------------------------------

devNull :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
devNull _ _ _ _ = return ()

commonLog :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
commonLog loc logSource level msg = do
  when (level >= flags_minLogLevel) $ do
    myTID <- myThreadId
    timestamp <- getCurrentTime
    lock $ formatLogOutput timestamp myTID loc logSource level msg
    hFlush stdout

formatLogOutput :: PrintfType r
                => UTCTime
                -> ThreadId
                -> Loc
                -> LogSource
                -> LogLevel
                -> LogStr
                -> r
formatLogOutput timestamp tid loc logSource level msg =
  printf "[%-30s] %s%5s | %-14s | %-35s | %s\n" timestamp mLoc level tid logSource msg
   where mLoc = if (level == LevelDebug || level == LevelWarn) then printf "%50s | " loc else ""

instance PrintfArg UTCTime where
  formatArg = formatString . show

instance PrintfArg LogLevel where
  formatArg = formatString . (\case
    LevelDebug -> "DEBUG"
    LevelInfo -> "INFO"
    LevelWarn -> "WARN"
    LevelError -> "ERROR"
    LevelOther o -> Text.unpack o)

instance PrintfArg ThreadId where
  formatArg = formatString . show

instance PrintfArg Loc where
  formatArg = formatString . (\Loc{..} -> printf "%s:%d" loc_filename (fst loc_start) :: String)

instance PrintfArg LogStr where
  formatArg = formatString . BC.unpack . fromLogStr

logDebugLS :: Q Exp
logDebugLS = [|\a b -> monadLoggerLog $(qLocation >>= liftLoc) a LevelDebug (show b)|]

logInfoLS :: Q Exp
logInfoLS = [|\a b -> monadLoggerLog $(qLocation >>= liftLoc) a LevelInfo (show b)|]

logWarnLS :: Q Exp
logWarnLS = [|\a b -> monadLoggerLog $(qLocation >>= liftLoc) a LevelWarn (show b)|]

logErrorLS :: Q Exp
logErrorLS = [|\a b -> monadLoggerLog $(qLocation >>= liftLoc) a LevelError (show b)|]

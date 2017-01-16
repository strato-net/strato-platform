
module Blockchain.Output (
    printLogMsg,
    printLogMsg',
    printToFile,
) where

import Control.Monad.Logger
import qualified Data.ByteString.Char8 as BC
import qualified Data.Text as Text
import System.GlobalLock
import System.Log.FastLogger (fromLogStr)
import System.IO

import Text.Printf

import Data.Time

leftPad :: Int -> a -> [a] -> [a]
leftPad n x xs = replicate (max 0 (n - length xs)) x ++ xs

rightPad :: Int -> a -> [a] -> [a]
rightPad n x xs = xs ++ replicate (max 0 (n - length xs)) x

-- todo: do something more efficient than a bunch of printfs?
-- todo: the pack/unpack in formatLogOutput is probably pain...
formatLoc :: Loc -> String
formatLoc Loc{ loc_filename = file
             , loc_start    = (line, _)
             } = leftPad 50 ' ' $ printf "%s:%d" file line

formatLogSource :: LogSource -> String
formatLogSource = leftPad 35 ' ' . Text.unpack

formatLogLevel :: LogLevel -> String
formatLogLevel = leftPad 5 ' ' . helper
    where helper LevelDebug     = "DEBUG"
          helper LevelInfo      = "INFO"
          helper LevelWarn      = "WARN"
          helper LevelError     = "ERROR"
          helper (LevelOther o) = show o

formatLogStr :: LogStr -> String
formatLogStr = BC.unpack . fromLogStr

formatLogOutput :: Bool -> Bool -> String -> Loc -> LogSource -> LogLevel -> LogStr -> BC.ByteString
formatLogOutput showLoc showTS timestamp loc logSource level msg = BC.pack $
    printf "%s%s%s | %s | %s" tsAndDivider locAndDivider (formatLogSource logSource) (formatLogLevel level) (formatLogStr msg)
    where locAndDivider = if showLoc then formatLoc loc ++ " | " else ""
          tsAndDivider = if showTS then '[':(timestamp ++ "] ") else ""

printLogMsg :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
printLogMsg = printLogMsg' False True

printLogMsg' :: Bool -> Bool -> Loc -> LogSource -> LogLevel -> LogStr -> IO ()
printLogMsg' showLoc showTimestamp loc logSource level msg = do
  timestamp <- if showTimestamp then rightPad 30 ' ' . show <$> getCurrentTime else return ""
  lock $ putStrLn $ BC.unpack $ formatLogOutput showLoc showTimestamp timestamp loc logSource level msg
  hFlush stdout

printToFile :: FilePath -> Loc -> LogSource -> LogLevel -> LogStr -> IO ()
printToFile path _ _ _ msg = lock $ appendFile path $ formatLogStr msg ++ "\n"


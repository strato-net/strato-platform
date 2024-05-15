{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Tools.DumpLevelDB
  ( showKeyVal,
    typeToDB,
  )
where

import Control.Monad (when)
import Control.Monad.IO.Class
import Control.Monad.Trans.Resource
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Default
import qualified Database.LevelDB as DB
import qualified LabeledError
import System.FilePath
import Text.Colors
import Text.Format

--import Debug.Trace

showAllKeyVal :: DB.DB -> (B.ByteString -> String) -> ResourceT IO ()
showAllKeyVal db f = do
  i <- DB.iterOpen db def
  DB.iterFirst i
  valid <- DB.iterValid i
  if valid
    then showAllKeyVal' db i
    else liftIO $ putStrLn "no keys"
  where
    showAllKeyVal' :: DB.DB -> DB.Iterator -> ResourceT IO ()
    showAllKeyVal' db' i = do
      Just key <- DB.iterKey i
      Just val <- DB.iterValue i
      if B.null val
        then liftIO $ putStrLn $ "----------\n" ++ blue (format key) ++ ": <BLANK>"
        else liftIO $ putStrLn $ "----------\n" ++ blue (format key) ++ ": " ++ f val
      DB.iterNext i
      v <- DB.iterValid i
      when v $ showAllKeyVal' db' i

showKeyVal :: (B.ByteString -> String) -> String -> Maybe String -> IO ()
showKeyVal f dbName maybeKey = do
  runResourceT $ do
    db <- DB.open ("/tmp/.ethereumH" </> dbName) def
    case maybeKey of
      Nothing -> showAllKeyVal db f
      Just key -> do
        maybeVal <- DB.get db def $ LabeledError.b16Decode "showKeyVal" $ BC.pack key
        case maybeVal of
          Nothing -> error $ "Missing value in database: " ++ show key
          Just val -> liftIO $ putStrLn $ f val

typeToDB :: String -> IO String
typeToDB "h" = return ".ethereumH"
typeToDB x = error $ "Unsupported case in typeToDB: " ++ show x

{-# LANGUAGE OverloadedStrings #-}
module BlockGO where

import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Loops
import           Control.Monad.Trans.Resource
import qualified Data.ByteString              as B
import           Data.Default
import qualified Database.LevelDB             as DB
import           System.FilePath
import           Text.PrettyPrint.ANSI.Leijen hiding ((<$>), (</>))

import           Blockchain.Constants
import           DumpLevelDB                  ()

import           Text.Format

ldbForEach :: FilePath -> (B.ByteString -> B.ByteString -> IO ()) -> IO ()
ldbForEach dbDir' f = runResourceT $ do
    db <- DB.open (dbDir' </> "blockchain") def
    i <- DB.iterOpen db def
    DB.iterFirst i
    whileM_ (DB.iterValid i) $ do
      Just key <- DB.iterKey i
      Just val <- DB.iterValue i
      liftIO $ f key val
      DB.iterNext i
      return ()

doit::String->IO ()
doit h = ldbForEach (dbDir h) $ \key val ->
      when (B.isPrefixOf "block" key) $
        putStrLn $ "----------\n"
                     ++ show (pretty key)
                     ++ ": "
                     ++ format val
--                     ++ (formatBlock . rlpDecode . rlpDeserialize) val

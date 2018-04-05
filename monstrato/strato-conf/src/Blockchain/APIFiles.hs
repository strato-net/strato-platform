{-# LANGUAGE TemplateHaskell #-}

module Blockchain.APIFiles
    (
      stratoAPIStaticDir,
      stratoAPIConfigDir,
      stratoAPICerts,
      inflateDir
    ) where

import           Data.FileEmbed
import           System.Directory
import           System.FilePath

import qualified Data.ByteString  as B


stratoAPIStaticDir' :: [(FilePath, B.ByteString)]
stratoAPIStaticDir' = $(embedDir (".." </> "strato-api" </> "static"))

stratoAPIConfigDir' :: [(FilePath, B.ByteString)]
stratoAPIConfigDir' = $(embedDir (".." </> "strato-api" </> "config"))

stratoAPIStaticDir :: [(FilePath, B.ByteString)]
stratoAPIStaticDir = map (\(t,b) -> ("static" </> t, b)) stratoAPIStaticDir'

stratoAPIConfigDir :: [(FilePath, B.ByteString)]
stratoAPIConfigDir = map (\(t,b) -> ("config" </> t, b)) stratoAPIConfigDir'

stratoAPICerts' :: [(FilePath, B.ByteString)]
stratoAPICerts' = $(embedDir (".." </> "strato-api" </> "certs"))

stratoAPICerts :: [(FilePath, B.ByteString)]
stratoAPICerts = map (\(t,b) -> ("certs" </> t, b)) stratoAPICerts'

inflateDir :: [(FilePath, B.ByteString)] -> IO ()
inflateDir = mapM_ $ \(file,contents) -> do
     createDirectoryIfMissing True $ dropFileName $ file
     B.writeFile file contents

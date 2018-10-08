{-# LANGUAGE TemplateHaskell #-}

module Blockchain.APIFiles
    (
      stratoAPIConfigDir,
      stratoAPICerts,
      inflateDir
    ) where

import           Data.FileEmbed
import           System.Directory
import           System.FilePath

import qualified Data.ByteString  as B


stratoAPIConfigDir' :: [(FilePath, B.ByteString)]
stratoAPIConfigDir' = $(embedDir (".." </> "strato-api" </> "config"))

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

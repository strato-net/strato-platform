{-# LANGUAGE CPP #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.APIFiles
    (
      stratoAPIConfigDir,
      stratoAPICerts,
      inflateDir
    ) where

#ifdef EMBED
import           Data.FileEmbed
#endif
import           System.Directory
import           System.FilePath

import qualified Data.ByteString  as B


#ifdef EMBED
stratoAPIConfigDir' :: [(FilePath, B.ByteString)]
stratoAPIConfigDir' = $(embedDir (".." </> "strato-api" </> "config"))
#else
stratoAPIConfigDir' :: [(FilePath, B.ByteString)]
stratoAPIConfigDir' = []
#endif

stratoAPIConfigDir :: [(FilePath, B.ByteString)]
stratoAPIConfigDir = map (\(t,b) -> ("config" </> t, b)) stratoAPIConfigDir'

#ifdef EMBED
stratoAPICerts' :: [(FilePath, B.ByteString)]
stratoAPICerts' = $(embedDir (".." </> "strato-api" </> "certs"))
#else
stratoAPICerts' :: [(FilePath, B.ByteString)]
stratoAPICerts' = []
#endif

stratoAPICerts :: [(FilePath, B.ByteString)]
stratoAPICerts = map (\(t,b) -> ("certs" </> t, b)) stratoAPICerts'

inflateDir :: [(FilePath, B.ByteString)] -> IO ()
inflateDir = mapM_ $ \(file,contents) -> do
     createDirectoryIfMissing True $ dropFileName $ file
     B.writeFile file contents

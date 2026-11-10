{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.BuildMetadata.TH (getValue, embedRepoFile) where

import Language.Haskell.TH
import Language.Haskell.TH.Syntax (addDependentFile)
import System.Process (readProcess)
import Control.Exception (try, SomeException)

-- | A file of the repository, named by its path from the root.
readRepoFile :: FilePath -> Q String
readRepoFile path = do
  gitRoot <- runIO $ do
    result <- try $ readProcess "git" ["rev-parse", "--show-toplevel"] "" :: IO (Either SomeException String)
    case result of
      Right r -> return $ takeWhile (/= '\n') r
      Left _ -> error "Not in a git repository"

  let file = gitRoot ++ "/" ++ path
  addDependentFile file

  runIO $ readFile file

readVersionFile :: Q [(String, String)]
readVersionFile = parseVersionFile <$> readRepoFile "BUILD_METADATA"

embedRepoFile :: FilePath -> Q Exp
embedRepoFile path = readRepoFile path >>= litE . stringL

parseVersionFile :: String -> [(String, String)]
parseVersionFile contents = 
  [ (key, value) 
  | line <- lines contents
  , let (key, rest) = break (== '=') line
  , not (null rest)
  , let value = drop 1 rest
  ]

getValue :: String -> Q Exp
getValue key = do
  pairs <- readVersionFile
  case lookup key pairs of
    Just v -> litE $ stringL v
    Nothing -> error $ "Key not found in VERSION file: " ++ key

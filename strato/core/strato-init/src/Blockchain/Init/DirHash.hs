{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.DirHash (computeDirHash) where

import Language.Haskell.TH
import System.Process (readProcess)

-- Compute content hash of a directory at compile time
-- Same algorithm as Makefile: git ls-files | sort | xargs sha256sum | sha256sum | cut -c1-12
-- Runs from git root to handle TH running from package subdirectory
computeDirHash :: String -> Q Exp
computeDirHash dir = do
  result <- runIO $ readProcess "sh" ["-c",
    "cd $(git rev-parse --show-toplevel) && " ++
    "git ls-files " ++ dir ++ " 2>/dev/null | sort | xargs sha256sum 2>/dev/null | sha256sum | cut -c1-12"
    ] ""
  litE $ stringL $ filter (/= '\n') result

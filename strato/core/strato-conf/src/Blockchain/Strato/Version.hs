{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Strato.Version
  ( stratoVersion
  , stratoVersionTag
  ) where

import Control.Exception (IOException, try)
import Data.List (isInfixOf, isPrefixOf)
import Language.Haskell.TH
import System.Process (readProcess)

-- | Full version from git describe, e.g., "16.6.1-38-g604abc945c-dirty"
stratoVersion :: String
stratoVersion = $(do
  result <- runIO $ try $ readProcess "git" ["describe", "--tags", "--always", "--dirty"] ""
  case result of
    Right v -> litE $ stringL $ filter (/= '\n') v
    Left (_ :: IOException) -> do
      -- Not a git repo - check if export-subst expanded the placeholders
      -- These literals are replaced by git archive: $Format:%D$ and $Format:%h$
      let gitArchiveRefs = "$Format:%D$"
          gitArchiveHash = "$Format:%h$"
          -- Inline tag extraction to avoid TH stage restriction
          extractTag refs = 
            let afterTag = drop 5 $ snd $ span (/= 't') refs  -- skip to after "tag: "
            in takeWhile (\c -> c /= ',' && c /= ' ') afterTag
      if "$" `isPrefixOf` gitArchiveRefs then
        -- Placeholders not expanded = not a git archive either
        fail "Cannot determine version: not a git repository and not a git archive. Please clone with git."
      else if "tag: " `isInfixOf` gitArchiveRefs then
        -- Has a tag - extract it (e.g., "tag: 16.6.1, origin/master" -> "16.6.1")
        litE $ stringL $ extractTag gitArchiveRefs
      else
        -- No tag, use the commit hash
        litE $ stringL gitArchiveHash
  )

-- | Just the tag portion, e.g., "16.6.1" (used for docker image tags)
stratoVersionTag :: String
stratoVersionTag = $(do
  result <- runIO $ try $ readProcess "git" ["describe", "--tags", "--abbrev=0"] ""
  case result of
    Right v -> litE $ stringL $ filter (/= '\n') v
    Left (_ :: IOException) -> do
      let gitArchiveRefs = "$Format:%D$"
          gitArchiveHash = "$Format:%h$"
          extractTag refs = 
            let afterTag = drop 5 $ snd $ span (/= 't') refs
            in takeWhile (\c -> c /= ',' && c /= ' ') afterTag
      if "$" `isPrefixOf` gitArchiveRefs then
        fail "Cannot determine version: not a git repository and not a git archive. Please clone with git."
      else if "tag: " `isInfixOf` gitArchiveRefs then
        litE $ stringL $ extractTag gitArchiveRefs
      else
        litE $ stringL gitArchiveHash
  )

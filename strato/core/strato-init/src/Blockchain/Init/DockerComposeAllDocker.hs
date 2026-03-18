{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Init.DockerComposeAllDocker (generateDockerComposeAllDocker) where

import Blockchain.Init.BuildMetadata
import Blockchain.Init.Options (flags_repoUrl)
import Blockchain.Strato.Version (stratoVersionTag)
import Data.List (foldl', isPrefixOf)
import Language.Haskell.TH (runIO, Exp(LitE), Lit(StringL))
import System.IO (hPutStrLn, stderr)
import System.Process (readProcess)

templateContent :: String
templateContent = $(runIO $ do
  content <- readProcess "sh" ["-c",
    "cd $(git rev-parse --show-toplevel) && cat docker-compose.allDocker.tpl.yml"
    ] ""
  return $ LitE $ StringL content)

substituteAll :: [(String, String)] -> String -> String
substituteAll subs content = foldl' (\c (old, new) -> replace old new c) content subs
  where
    replace :: String -> String -> String -> String
    replace _ _ [] = []
    replace old new str@(x:xs)
      | take (length old) str == old = new ++ replace old new (drop (length old) str)
      | otherwise = x : replace old new xs

-- | Strip lines containing "build:" directive (equivalent to awk '/build: ./{getline} 1')
stripBuildLines :: String -> String
stripBuildLines = unlines . filter (not . isBuildLine) . lines
  where
    isBuildLine l = let stripped = dropWhile (== ' ') l
                    in "build:" `isPrefixOf` stripped

generateDockerComposeAllDocker :: Bool -> Bool -> IO ()
generateDockerComposeAllDocker composeOnly includeBuild = do
  -- In composeOnly mode, skip postgres_password substitution
  pgSubstitution <- if composeOnly
    then return []
    else do
      pgPassword <- readFile "secrets/postgres_password"
      return [("${postgres_password:-api}", pgPassword)]

  let substitutions =
        [ ("<VERSION>", stratoVersionTag)
        , ("<HASH_STRATO>", hashStrato)
        , ("<HASH_MERCATA_BACKEND>", hashMercataBackend)
        , ("<HASH_MERCATA_UI>", hashMercataUi)
        , ("<HASH_SMD>", hashSmd)
        , ("<HASH_APEX>", hashApex)
        , ("<HASH_POSTGREST>", hashPostgrest)
        , ("<HASH_NGINX>", hashNginx)
        , ("<HASH_PROMETHEUS>", hashPrometheus)
        , ("<REPO_URL>", flags_repoUrl)
        ] ++ pgSubstitution

      composed = substituteAll substitutions templateContent
      result = if includeBuild then composed else stripBuildLines composed

  if composeOnly
    then putStr result
    else do
      writeFile "docker-compose.yml" result
      hPutStrLn stderr "  ✓ Generated docker-compose.yml (allDocker)"

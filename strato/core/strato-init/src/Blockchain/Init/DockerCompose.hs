{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Init.DockerCompose (generateDockerCompose) where

import Blockchain.Init.DirHash (computeDirHash)
import Blockchain.Init.Options
import Data.FileEmbed (embedStringFile)
import Data.List (foldl')
import qualified Data.Text as T
import qualified Data.Text.IO as TIO
import System.Posix.User (getEffectiveUserID, getEffectiveGroupID)

dockerComposeTemplate :: T.Text
dockerComposeTemplate = $(embedStringFile "templates/docker-compose.tmpl.yml")

-- Image hashes computed at compile time
imageHashes :: [(String, String)]
imageHashes =
  [ ("postgrest", $(computeDirHash "postgrest-packager"))
  , ("nginx", $(computeDirHash "nginx-packager"))
  , ("apex", $(computeDirHash "apex"))
  , ("mercata-backend", $(computeDirHash "mercata/backend"))
  , ("mercata-ui", $(computeDirHash "mercata/ui"))
  , ("prometheus", $(computeDirHash "prometheus-packager"))
  , ("smd", $(computeDirHash "smd-ui"))
  , ("bridge", $(computeDirHash "mercata/services/bridge"))
  , ("bridge-nginx", $(computeDirHash "mercata/services/bridge/nginx"))
  ]

generateDockerCompose :: IO ()
generateDockerCompose = do
  uid <- show <$> getEffectiveUserID
  gid <- show <$> getEffectiveGroupID
  
  let httpPort = "8081"  -- TODO: make this a flag
      nodeHost = "localhost:" ++ httpPort
      stratoHostname = flags_apiIPAddress
      vaultUrl = flags_vaultUrl
  
  -- Create substitutions for each image: "imagename:<VERSION>" -> "imagename:hash"
  let imageSubstitutions = map (\(img, hash) -> (img ++ ":<VERSION>", img ++ ":" ++ hash)) imageHashes
  
  let substitutions =
        [ ("${DOCKER_UID}", uid)
        , ("${DOCKER_GID}", gid)
        , ("${NODE_HOST}", nodeHost)
        , ("${HTTP_PORT:-80}", httpPort)
        , ("${HTTP_PORT}", httpPort)
        , ("${STRATO_HOSTNAME}", stratoHostname)
        , ("${VAULT_URL}", vaultUrl)
        , ("<REPO_URL>", "")  -- Use local images, no repo prefix
        ] ++ imageSubstitutions
  
  let processed = removeBuildLines $ substituteAll substitutions dockerComposeTemplate
      result = applyDefaults processed
  TIO.writeFile "docker-compose.yml" result
  putStrLn "Generated docker-compose.yml"

substituteAll :: [(String, String)] -> T.Text -> T.Text
substituteAll subs template =
  foldl' (\t (var, val) -> T.replace (T.pack var) (T.pack val) t) template subs

removeBuildLines :: T.Text -> T.Text
removeBuildLines = T.unlines . filter (not . isBuildLine) . T.lines
  where
    isBuildLine line = "build:" `T.isInfixOf` T.stripStart line

applyDefaults :: T.Text -> T.Text
applyDefaults = T.unlines . map processLine . T.lines
  where
    processLine line
      | "${" `T.isInfixOf` line = applyDefaultsToLine line
      | otherwise = line

applyDefaultsToLine :: T.Text -> T.Text
applyDefaultsToLine line =
  case T.breakOn "${" line of
    (before, rest) | not (T.null rest) ->
      case T.breakOn "}" (T.drop 2 rest) of
        (varPart, afterBrace) | not (T.null afterBrace) ->
          let afterClose = T.drop 1 afterBrace
          in case T.breakOn ":-" varPart of
               (_varName, defaultPart) | not (T.null defaultPart) ->
                 let defaultVal = T.drop 2 defaultPart
                 in before <> defaultVal <> applyDefaultsToLine afterClose
               _ -> 
                 before <> "${" <> varPart <> "}" <> applyDefaultsToLine afterClose
        _ -> line
    _ -> line

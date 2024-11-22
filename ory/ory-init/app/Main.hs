{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Main (main) where

import Control.Monad
import qualified Data.Aeson as AESON
import qualified Data.Aeson.Key as AESON
import qualified Data.Aeson.KeyMap as AESON
import Data.Maybe
import Data.Sort
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.IO as T
import GitImage
import GHC.Generics
import Resources
import System.Console.CmdArgs
import System.Directory
import System.FilePath
import Text.Regex.TDFA

data Options =
  Options {
    basePath :: String,
    sslDir :: String,
    domainName :: String,
    identityServerUrl :: String
  } deriving (Data, Generic)

instance AESON.FromJSON Options where
instance AESON.ToJSON Options where

type Vars = [(Text, Text)]
  
defaultOptions :: Options
defaultOptions =
  Options {
    basePath = "ory" &= argPos 0,
    sslDir = "",
    domainName = "",
    identityServerUrl = ""
  }

substitutionStrings :: AESON.Value -> [(Text, Text)]
substitutionStrings (AESON.Object items) = catMaybes $ map (sequence . \(n, v) -> ("${" <> AESON.toText n <> "}", valToString v)) $ AESON.toList (items :: AESON.KeyMap AESON.Value)
substitutionStrings _ = []

valToString :: AESON.Value -> Maybe Text
valToString (AESON.String s) = Just s
valToString _ = Nothing


main :: IO ()
main = do
  options <- cmdArgs defaultOptions

  when (sslDir options == "") $ error "You need to supply a ssldir parameter"
  when (domainName options == "") $ error "You need to supply a domainname parameter"
  when (identityServerUrl options == "") $ error "You need to supply a identityserverurl parameter"

  images <- getGitImages

  let imageNames = uniqueSort $ map repository images
      newestImage n = last $ sortOn createdAt $ filter ((== n) . repository) images
      imageSubstitutionStrings = map (\n -> ("${image:" <> n <> "}", formatImageName $ newestImage n)) imageNames

  createDirectory $ basePath options

  let vars =  substitutionStrings (AESON.toJSON options) ++ imageSubstitutionStrings

  processFile (basePath options </> "docker-compose.yml") vars dockerComposeTemplate
  processFile (basePath options </> "kratos.yml") vars kratosConfig
  processFile (basePath options </> "hydra.yml") vars hydraConfig
  processFile (basePath options </> "default.schema.json") vars defaultSchema
  processFile (basePath options </> "nginx.conf") vars nginxConfig


processFile :: FilePath -> Vars -> Text -> IO ()
processFile filePath vars input = do
  let output = substituteVariables vars input
      remainingMatches = getAllTextMatches (output =~ ("\\${[a-zA-Z]+}"::Text)) :: [Text]
      
  when (not $ null remainingMatches) $ putStrLn $ "⚠️   Warning: some variables were missing!\n  missing variables: " ++ unwords (map show remainingMatches)

  T.writeFile filePath output


substituteVariables :: Vars -> Text -> Text
substituteVariables [] theText = theText
substituteVariables ((key, value):rest) theText = substituteVariables rest $ T.replace key value theText


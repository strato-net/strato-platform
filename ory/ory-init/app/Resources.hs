{-# LANGUAGE TemplateHaskell #-}

module Resources (
  dockerComposeTemplate,
  hydraConfig,
  kratosConfig,
  defaultSchema,
  nginxConfig
  ) where

import Data.FileEmbed
import Data.Text (Text)
import Data.Text.Encoding

dockerComposeTemplate :: Text
dockerComposeTemplate = decodeUtf8Lenient $(embedFile "resources/docker-compose.tmp.yml")

hydraConfig :: Text
hydraConfig = decodeUtf8Lenient $(embedFile "resources/hydra.yml")

kratosConfig :: Text
kratosConfig = decodeUtf8Lenient $(embedFile "resources/kratos.yml")

defaultSchema :: Text
defaultSchema = decodeUtf8Lenient $(embedFile "resources/default.schema.json")

nginxConfig :: Text
nginxConfig = decodeUtf8Lenient $(embedFile "resources/nginx.tpl.conf")

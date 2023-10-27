{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.Strato23.API.Types
  ( module Strato.Strato23.API.Types,
    Address (..),
    Signature (..), -- TODO: remove, ideally
    PublicKey (..), --       same
    SharedKey (..), --       same
    Version (..),
  )
where


import qualified Data.ByteString.Lazy               as BL
import qualified Data.List.NonEmpty                 as NE
import           Data.Proxy
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Secp256k1
import           Control.Lens ((&), (?~))
import           Data.Aeson.Casing
import           Data.Aeson.Casing.Internal (dropFPrefix)
import           Data.Aeson.Types hiding (fieldLabelModifier)
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import           Data.Swagger
import           Data.Swagger.Internal.Schema (named)
import qualified Data.Text as T
import           GHC.Generics
import           Network.HTTP.Media ((//), (/:))
import           Servant.API.ContentTypes
import qualified LabeledError

data Web = Web

instance Accept Web where
  contentTypes _ = "text" // "html" /: ("charset", "utf-8")
             NE.:| [ "text"        // "html"
                   , "text"        // "css"
                   , "text"        // "css" /: ("charset", "utf-8")
                   , "text"        // "javascript"
                   , "text"        // "javascript" /: ("charset", "utf-8")
                   , "application" // "json"
                   , "application" // "json" /: ("charset", "utf-8")
                   , "application" // "octet-stream"
                   , "application" // "font-woff"
                   , "application" // "font-woff2"
                   , "image"       // "png"
                   , "image"       // "jpeg"
                   , "image"       // "jpg"
                   , "image"       // "gif"
                   , "image"       // "svg+xml"
                   , "image"       // "apng"
                   , "image"       // "avif"
                   , "image"       // "webp"
                   ]

instance MimeRender Web ContentTypeAndBody where
  mimeRender _ (ContentTypeAndBody _ b) = b

data ContentTypeAndBody = ContentTypeAndBody { contentTypeHeader :: BL.ByteString, body :: BL.ByteString } deriving (Eq, Show)

instance ToSample ContentTypeAndBody where
  toSamples _ = singleSample (ContentTypeAndBody "text/html" "<html><body><h1>Hello World</h1></body></html>")

instance ToSchema ContentTypeAndBody where
  declareNamedSchema _ = declareNamedSchema (Proxy :: Proxy ContentTypeAndBody)
    & mapped.schema.description ?~ "Content-Type header and ByteString body"
    & mapped.schema.example ?~ "ContentTypeAndBody \"text/html\" \"<html><body><h1>Hello World</h1></body></html>\""

instance AllCTRender '[Web] ContentTypeAndBody where
  handleAcceptH _ _ (ContentTypeAndBody h c) = Just (h, c)

type HighwayAPI =
  "file" :> Capture "hash" Keccak256 :> Get '[Web] ContentTypeAndBody
  :<|>
  "file" :> Put '[Web] ContentTypeAndBody 

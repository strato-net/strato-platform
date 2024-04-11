{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.API
  ( module Strato.API,
    ContentTypeAndBody(..)
  )
where

import           Conduit
import           Data.ByteString.Char8              as DBC8
import qualified Data.ByteString.Lazy               as DBL
import qualified Data.List.NonEmpty                 as NE
import qualified Data.Text                          as T
import           Data.Text.Encoding                 (encodeUtf8)
import           Network.HTTP.Conduit
import           Network.HTTP.Media ((//), (/:))
import           Servant.API
import           Servant.API.ContentTypes
import           Servant.Multipart

data Web = Web

instance Accept Web where
  contentTypes _ = "text" // "html" /: ("charset", "utf-8")
             NE.:| [ "text"        // "html"
                   , "text"        // "css"
                   , "text"        // "css" /: ("charset", "utf-8")
                   , "text"        // "javascript"
                   , "text"        // "javascript" /: ("charset", "utf-8")
                   , "text"        // "plain"
                   , "application" // "json"
                   , "application" // "json" /: ("charset", "utf-8")
                   , "application" // "octet-stream"
                   , "application" // "font-woff"
                   , "application" // "font-woff2"
                   , "application" // "pdf"
                   , "image"       // "png"
                   , "image"       // "jpeg"
                   , "image"       // "jpg"
                   , "image"       // "gif"
                   , "image"       // "svg+xml"
                   , "image"       // "apng"
                   , "image"       // "avif"
                   , "image"       // "webp"
                   ]

data ContentTypeAndBody = ContentTypeAndBody { contentTypeHeader :: DBL.ByteString
                                             , contentTypeBody   :: DBL.ByteString
                                             }
  deriving (Eq,Show)

instance MimeRender Web ContentTypeAndBody where --Is this correct?
  mimeRender _ (ContentTypeAndBody _ b) = b

instance MimeRender Web T.Text where
  mimeRender _ = DBL.fromStrict . encodeUtf8

instance AllCTRender '[Web] ContentTypeAndBody where
  handleAcceptH _ _ (ContentTypeAndBody h c) = Just (h,c)

type HighwayGetS3File = "highway" :> Capture "filename" T.Text :> Get '[Web] ContentTypeAndBody

type HighwayGetS3FileTesting = "highwaytesting" :> Capture "filename" T.Text :> Get '[Web] (Response (ConduitM () DBC8.ByteString (ResourceT IO) ()),ContentTypeAndBody)

type HighwayPutS3File = "highway" :> MultipartForm Mem (MultipartData Mem) :> Post '[Web] T.Text

type HighwayPing      = "ping" :> Get '[JSON] Int

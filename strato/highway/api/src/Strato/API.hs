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

import qualified Data.ByteString.Char8              as DBC8
import qualified Data.ByteString.Lazy               as DBL
import qualified Data.List.NonEmpty                 as NE
import qualified Data.Text                          as T
import           Data.Text.Encoding                 (decodeUtf8',encodeUtf8)
import           Network.HTTP.Media ((//), (/:))
import           Network.HTTP.Types.Status (Status(..))
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

instance MimeUnrender Web T.Text where
  mimeUnrender _ bs =
    case decodeUtf8' $ DBL.toStrict bs of
      Left exception ->
        Left $ show exception
      Right decodedbs ->
        Right decodedbs

instance MimeUnrender Web ContentTypeAndBody where
  mimeUnrender _ bs =
    case decodeUtf8' $ DBL.toStrict bs of
      Left exception ->
        Left $ show exception
      Right decodedbs ->
        Right $ ContentTypeAndBody { contentTypeHeader = DBL.empty
                                   , contentTypeBody   = DBL.fromStrict $ encodeUtf8 decodedbs
                                   }

instance MimeUnrender Web (Status,ContentTypeAndBody) where
  mimeUnrender _ bs =
    case decodeUtf8' $ DBL.toStrict bs of
      Left exception ->
        Left $ show exception
      Right decodedbs ->
        Right $ ( Status { statusCode    = 200
                         , statusMessage = DBC8.pack ""
                         } 
                , ContentTypeAndBody { contentTypeHeader = DBL.empty
                                     , contentTypeBody   = DBL.fromStrict $ encodeUtf8 decodedbs
                                     }
                )

instance MimeRender Web ContentTypeAndBody where --Is this correct?
  mimeRender _ (ContentTypeAndBody _ b) = b

instance MimeRender Web (Status,ContentTypeAndBody) where
  mimeRender _ (_,ContentTypeAndBody _ b) = b

instance MimeRender Web T.Text where
  mimeRender _ = DBL.fromStrict . encodeUtf8

instance AllCTRender '[Web] ContentTypeAndBody where
  handleAcceptH _ _ (ContentTypeAndBody h c) = Just (h,c)

type HighwayGetS3File = "highway" :> Capture "filename" T.Text :> Get '[Web] ContentTypeAndBody

type HighwayGetS3FileTesting = "highwaytesting" :> Capture "filename" T.Text :> Get '[Web] (Status,ContentTypeAndBody)

type HighwayPutS3File = "highway" :> MultipartForm Mem (MultipartData Mem) :> Post '[Web] T.Text

type HighwayPing      = "ping" :> Get '[JSON] Int

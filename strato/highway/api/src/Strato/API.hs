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
import           Blockchain.Strato.Model.Keccak256
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

data ContentTypeAndBody = ContentTypeAndBody { contentTypeHeader :: DBL.ByteString
                                             , contentTypeBody   :: DBL.ByteString
                                             }
  deriving (Eq,Show)

instance MimeRender Web ContentTypeAndBody where --Is this correct?
  mimeRender _ (ContentTypeAndBody _ b) = b

instance MimeUnrender Web ContentTypeAndBody where
  mimeUnrender a bs = Right $ ContentTypeAndBody { contentTypeHeader = DBL.fromStrict $ DBC8.pack $ show a --Need to double check
                                                 , contentTypeBody   = bs                                  --both of these
                                                 } 

instance MimeRender Web () where
  mimeRender _ _ = DBL.empty

instance AllCTRender '[Web] ContentTypeAndBody where
  handleAcceptH _ _ (ContentTypeAndBody h c) = Just (h,c)

type HighwayGetS3File = "gets3file" :> Capture "hash" Keccak256 :> Get '[Web] ContentTypeAndBody

type HighwayPutS3File = "puts3file" :> MultipartForm Mem (MultipartData Mem) :> Put '[Web] ()

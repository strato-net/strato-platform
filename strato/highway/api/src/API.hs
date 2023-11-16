{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module API
  ( HighwayWrapperAPI,
    module Strato.API
  )
where

import Servant
import Strato.API

type HighwayWrapperAPI =
  HighwayGetS3File
    :<|> HighwayPutS3File
    :<|> HighwayPing

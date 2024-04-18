{-# LANGUAGE TypeApplications #-}

module Strato.Client where

import Data.Proxy

import API

highwayWrapperClientAPI :: Proxy HighwayWrapperAPI
highwayWrapperClientAPI = Proxy

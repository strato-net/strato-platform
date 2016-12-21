{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeFamilies      #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Handler.UUIDInfo where

import Import

import Blockchain.EthConf

getUUIDInfoR :: Handler TypedContent
getUUIDInfoR = selectRep $ do
    provideJson $ ethUniqueId ethConf


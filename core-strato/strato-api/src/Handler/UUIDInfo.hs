{-# LANGUAGE DeriveGeneric       #-}
{-# LANGUAGE OverloadedStrings   #-}
{-# LANGUAGE QuasiQuotes         #-}
{-# LANGUAGE RecordWildCards     #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell     #-}
{-# LANGUAGE TypeFamilies        #-}

module Handler.UUIDInfo where

import           Import

import           Blockchain.EthConf

getUUIDInfoR :: HandlerFor App TypedContent
getUUIDInfoR = selectRep
             . provideJson
             . ethUniqueId
             $ ethConf


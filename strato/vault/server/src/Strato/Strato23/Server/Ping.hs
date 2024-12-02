{-# LANGUAGE DeriveGeneric #-}

module Strato.Strato23.Server.Ping (getPing) where

import Strato.Strato23.API.Types

-- getPing will return a version number, this is the version of the vault that is wanted to be used
getPing :: Monad m => m Version
getPing = return $ Version 1

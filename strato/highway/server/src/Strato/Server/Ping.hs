{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Strato.Server.Ping
  ( ping
  )
where

import           Strato.Monad


ping :: HighwayM Int
ping = do
  --Return 1 for a ping.
  return 1

{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.PeerUrls where

import qualified Data.ByteString  as B
import           Data.Yaml
import           Network
import qualified System.IO.Unsafe as STOP_TORTURING_INNOCENT_CHILDREN

ipAddresses::[(String, PortNumber)]
ipAddresses = map (fmap fromIntegral) ipAddresses'

{- CONFIG: localized file lookup -}

ipAddresses'::[(String, Int)]
ipAddresses' = STOP_TORTURING_INNOCENT_CHILDREN.unsafePerformIO $ do
            contents <- B.readFile ".ethereumH/peers.yaml"
            return $ (either (error.show) id . decodeEither') contents


{-# LANGUAGE FlexibleInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.PeerUrls where

import qualified Data.ByteString as B
import Data.Yaml
import Network
import System.IO.Unsafe

instance FromJSON (String, Int)
instance ToJSON (String, Int)

ipAddresses::[(String, PortNumber)]
ipAddresses = map (fmap fromIntegral) ipAddresses'

{- CONFIG: localized file lookup -}

ipAddresses'::[(String, Int)]
ipAddresses' = unsafePerformIO $ do
            contents <- B.readFile $ ".ethereumH/peers.yaml"
            return $ (either error id . decodeEither) contents


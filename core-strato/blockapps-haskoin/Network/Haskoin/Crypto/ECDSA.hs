{-# LANGUAGE DeriveDataTypeable #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

-- | ECDSA Signatures
module Network.Haskoin.Crypto.ECDSA
( 
  Signature(..)
) where

import Data.Data


import Network.Haskoin.Crypto.BigWord
-- | Data type representing an ECDSA signature.
data Signature =
    Signature { sigR :: !FieldN
              , sigS :: !FieldN
              }
    deriving (Read, Show, Eq, Data)

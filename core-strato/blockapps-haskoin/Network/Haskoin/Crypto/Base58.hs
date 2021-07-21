
-- {-# OPTIONS -fno-warn-unused-top-binds #-}
-- {-# OPTIONS -fno-warn-unused-imports #-}

module Network.Haskoin.Crypto.Base58
( Address(..)
) where


import Network.Haskoin.Crypto.BigWord
-- |Data type representing a Bitcoin address
data Address
    -- | Public Key Hash Address
    = PubKeyAddress { getAddrHash :: Word160 }
    -- | Script Hash Address
    | ScriptAddress { getAddrHash :: Word160 }
       deriving (Eq, Ord, Show, Read)

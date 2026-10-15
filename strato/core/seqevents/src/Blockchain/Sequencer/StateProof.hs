{-# LANGUAGE OverloadedStrings #-}

-- | Merkle-Patricia proofs of an account and items of its storage against a
-- state root: the payload the VM returns for 'JRCGetProof'.
module Blockchain.Sequencer.StateProof
  ( StateProof (..),
    StorageProof (..),
  )
where

import Blockchain.Sequencer.HexData (HexData)
import Data.Aeson

data StorageProof = StorageProof
  { -- | The storage key as requested (for SolidVM, the ASCII storage path).
    spKey :: HexData,
    -- | The trie key walked: keccak256 of 'spKey'.
    spTrieKey :: HexData,
    -- | The leaf's value item exactly as encoded in the trie (for SolidVM, the
    --   RLP list of the BasicValue). Nothing when the key is absent.
    spValue :: Maybe HexData,
    -- | RLP trie nodes from the storage root to the leaf.
    spProof :: [HexData]
  }
  deriving (Eq, Show)

data StateProof = StateProof
  { -- | RLP trie nodes from the state root to the account leaf.
    stpAccountProof :: [HexData],
    -- | The account RLP @[nonce, balance, contractRoot, codeHash(, chainId)]@:
    --   the bytes the leaf's value item (an RLP string) holds. Nothing when
    --   the account is absent.
    stpAccountLeaf :: Maybe HexData,
    stpStorage :: [StorageProof]
  }
  deriving (Eq, Show)

instance ToJSON StorageProof where
  toJSON s =
    object
      [ "key" .= spKey s,
        "trieKey" .= spTrieKey s,
        "value" .= spValue s,
        "proof" .= spProof s
      ]

instance FromJSON StorageProof where
  parseJSON = withObject "StorageProof" $ \o ->
    StorageProof
      <$> o .: "key"
      <*> o .: "trieKey"
      <*> o .:? "value"
      <*> o .: "proof"

instance ToJSON StateProof where
  toJSON p =
    object
      [ "accountProof" .= stpAccountProof p,
        "accountLeaf" .= stpAccountLeaf p,
        "storage" .= stpStorage p
      ]

instance FromJSON StateProof where
  parseJSON = withObject "StateProof" $ \o ->
    StateProof
      <$> o .: "accountProof"
      <*> o .:? "accountLeaf"
      <*> o .: "storage"

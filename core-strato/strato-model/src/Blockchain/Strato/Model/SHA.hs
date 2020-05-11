{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}

module Blockchain.Strato.Model.SHA (
  SHA,
  Keccak256,
  blockstanbulMixHash,
  formatKeccak256WithoutColor,
  hash,
  rlpHash,
  keccak256FromHex,
  keccak256ToByteString,
  keccak256ToHex,
  keccak256ToWord256,
  unsafeCreateKeccak256FromByteString,
  unsafeCreateKeccak256FromWord256
  ) where




import              Blockchain.Strato.Model.Keccak256

type SHA = Keccak256


{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.ABI.Codec
  ( -- * Type descriptors
    TypeDescriptor (..),
    parseTypeDescriptor,
    isDynamicType,
    typeArgToString,

    -- * Byte-level primitives
    padLeft32,
    padRight32,
    encodeUint256,
    encodeInt256,
    integerToBytesBE,
    bytesToIntegerBE,

    -- * Value-level encode / decode
    encodeStaticValue,
    isDynamicValue,
    decodeValue,
    abiDecode,
  )
where

import SolidVM.Model.ABI hiding (abiDecode)
import SolidVM.Model.ABI.Values

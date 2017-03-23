{-# LANGUAGE
    LambdaCase
#-}

module BlockApps.Ethereum.Abi.Type
  ( Type(..)
  , TypeStatic(..)
  , TypeDynamic(..)
  , typeIsDynamic
  , typeStaticByteSize
  , typeStaticBitSize
  ) where

import BlockApps.Ethereum.Abi.Int

data Type
  = TypeStatic TypeStatic
  | TypeDynamic TypeDynamic
  deriving (Eq,Show)

typeIsDynamic :: Type -> Bool
typeIsDynamic = \case
  TypeStatic _ -> False
  TypeDynamic _ -> True

data TypeStatic
  = TypeBool
  | TypeUInt8
  | TypeUInt16
  | TypeUInt24
  | TypeUInt32
  | TypeUInt40
  | TypeUInt48
  | TypeUInt56
  | TypeUInt64
  | TypeUInt72
  | TypeUInt80
  | TypeUInt88
  | TypeUInt96
  | TypeUInt104
  | TypeUInt112
  | TypeUInt120
  | TypeUInt128
  | TypeUInt136
  | TypeUInt144
  | TypeUInt152
  | TypeUInt160
  | TypeUInt168
  | TypeUInt176
  | TypeUInt184
  | TypeUInt192
  | TypeUInt200
  | TypeUInt208
  | TypeUInt216
  | TypeUInt224
  | TypeUInt232
  | TypeUInt240
  | TypeUInt248
  | TypeUInt256
  | TypeUInt
  | TypeInt8
  | TypeInt16
  | TypeInt24
  | TypeInt32
  | TypeInt40
  | TypeInt48
  | TypeInt56
  | TypeInt64
  | TypeInt72
  | TypeInt80
  | TypeInt88
  | TypeInt96
  | TypeInt104
  | TypeInt112
  | TypeInt120
  | TypeInt128
  | TypeInt136
  | TypeInt144
  | TypeInt152
  | TypeInt160
  | TypeInt168
  | TypeInt176
  | TypeInt184
  | TypeInt192
  | TypeInt200
  | TypeInt208
  | TypeInt216
  | TypeInt224
  | TypeInt232
  | TypeInt240
  | TypeInt248
  | TypeInt256
  | TypeInt
  | TypeAddress
  -- | TypeStatic
  -- | TypeUStatic
  | TypeBytes1
  | TypeBytes2
  | TypeBytes3
  | TypeBytes4
  | TypeBytes5
  | TypeBytes6
  | TypeBytes7
  | TypeBytes8
  | TypeBytes9
  | TypeBytes10
  | TypeBytes11
  | TypeBytes12
  | TypeBytes13
  | TypeBytes14
  | TypeBytes15
  | TypeBytes16
  | TypeBytes17
  | TypeBytes18
  | TypeBytes19
  | TypeBytes20
  | TypeBytes21
  | TypeBytes22
  | TypeBytes23
  | TypeBytes24
  | TypeBytes25
  | TypeBytes26
  | TypeBytes27
  | TypeBytes28
  | TypeBytes29
  | TypeBytes30
  | TypeBytes31
  | TypeBytes32
  | TypeArrayStatic Word256 TypeStatic
  deriving (Eq,Show)

typeStaticByteSize :: TypeStatic -> Word256
typeStaticByteSize = \case
  TypeBool -> 1
  TypeUInt8 -> 1
  TypeUInt16 -> 2
  TypeUInt24 -> 3
  TypeUInt32 -> 4
  TypeUInt40 -> 5
  TypeUInt48 -> 6
  TypeUInt56 -> 7
  TypeUInt64 -> 8
  TypeUInt72 -> 9
  TypeUInt80 -> 10
  TypeUInt88 -> 11
  TypeUInt96 -> 12
  TypeUInt104 -> 13
  TypeUInt112 -> 14
  TypeUInt120 -> 15
  TypeUInt128 -> 16
  TypeUInt136 -> 17
  TypeUInt144 -> 18
  TypeUInt152 -> 19
  TypeUInt160 -> 20
  TypeUInt168 -> 21
  TypeUInt176 -> 22
  TypeUInt184 -> 23
  TypeUInt192 -> 24
  TypeUInt200 -> 25
  TypeUInt208 -> 26
  TypeUInt216 -> 27
  TypeUInt224 -> 28
  TypeUInt232 -> 29
  TypeUInt240 -> 30
  TypeUInt248 -> 31
  TypeUInt256 -> 32
  TypeUInt -> 32
  TypeInt8 -> 1
  TypeInt16 -> 2
  TypeInt24 -> 3
  TypeInt32 -> 4
  TypeInt40 -> 5
  TypeInt48 -> 6
  TypeInt56 -> 7
  TypeInt64 -> 8
  TypeInt72 -> 9
  TypeInt80 -> 10
  TypeInt88 -> 11
  TypeInt96 -> 12
  TypeInt104 -> 13
  TypeInt112 -> 14
  TypeInt120 -> 15
  TypeInt128 -> 16
  TypeInt136 -> 17
  TypeInt144 -> 18
  TypeInt152 -> 19
  TypeInt160 -> 20
  TypeInt168 -> 21
  TypeInt176 -> 22
  TypeInt184 -> 23
  TypeInt192 -> 24
  TypeInt200 -> 25
  TypeInt208 -> 26
  TypeInt216 -> 27
  TypeInt224 -> 28
  TypeInt232 -> 29
  TypeInt240 -> 30
  TypeInt248 -> 31
  TypeInt256 -> 32
  TypeInt -> 32
  TypeAddress -> 20
  TypeBytes1 -> 1
  TypeBytes2 -> 2
  TypeBytes3 -> 3
  TypeBytes4 -> 4
  TypeBytes5 -> 5
  TypeBytes6 -> 6
  TypeBytes7 -> 7
  TypeBytes8 -> 8
  TypeBytes9 -> 9
  TypeBytes10 -> 10
  TypeBytes11 -> 11
  TypeBytes12 -> 12
  TypeBytes13 -> 13
  TypeBytes14 -> 14
  TypeBytes15 -> 15
  TypeBytes16 -> 16
  TypeBytes17 -> 17
  TypeBytes18 -> 18
  TypeBytes19 -> 19
  TypeBytes20 -> 20
  TypeBytes21 -> 21
  TypeBytes22 -> 22
  TypeBytes23 -> 23
  TypeBytes24 -> 24
  TypeBytes25 -> 25
  TypeBytes26 -> 26
  TypeBytes27 -> 27
  TypeBytes28 -> 28
  TypeBytes29 -> 29
  TypeBytes30 -> 30
  TypeBytes31 -> 31
  TypeBytes32 -> 32
  TypeArrayStatic len ty -> len * typeStaticByteSize ty

typeStaticBitSize :: TypeStatic -> Word256
typeStaticBitSize = (* 8) . typeStaticByteSize

data TypeDynamic
  = TypeBytes
  | TypeString
  | TypeArrayDynamic TypeStatic
  deriving (Eq,Show)

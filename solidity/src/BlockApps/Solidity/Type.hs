module BlockApps.Solidity.Type where

data Type
  = SimpleType SimpleType
  | TypeArray SimpleType
  | Mapping SimpleType Type
  -- | TypeFunction [Type] [Type]
  -- | Struct
  -- | Enum

data SimpleType
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
  | TypeUInt264
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
  | TypeInt264
  | TypeInt
  | TypeAddress
  -- | TypeFixed
  -- | TypeUFixed
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
  | TypeBytes
  | TypeString
  -- | TypeContract

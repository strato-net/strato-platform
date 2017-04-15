{-# LANGUAGE
    LambdaCase
#-}

module BlockApps.Ethereum.Abi.Type
  ( Type(..)
  , validType
  , typeIsDynamic
  , typeByteSize
  , typeBitSize
  ) where

import Data.Maybe

data Type
  = TypeBool
  | TypeUInt (Maybe Int)
  | TypeInt (Maybe Int)
  | TypeAddress
  -- | TypeFixed
  -- | TypeUFixed
  | TypeBytesStatic Int
  | TypeBytesDynamic
  | TypeString
  | TypeArrayStatic Int Type
  | TypeArrayDynamic Type
  deriving (Eq,Show)

validType :: Type -> Bool
validType = \case
  TypeBool -> True
  TypeUInt Nothing -> True
  TypeUInt (Just n) -> n `mod` 8 == 0 && 8 <= n && n <= 256
  TypeInt Nothing -> True
  TypeInt (Just n) -> n `mod` 8 == 0 && 8 <= n && n <= 256
  TypeAddress -> True
  TypeBytesStatic n -> 1 <= n && n <= 32
  TypeBytesDynamic -> True
  TypeString -> True
  TypeArrayStatic _ ty -> validType ty
  TypeArrayDynamic ty -> validType ty

typeIsDynamic :: Type -> Bool
typeIsDynamic = \case
  TypeBool -> False
  TypeUInt _ -> False
  TypeInt _ -> False
  TypeAddress -> False
  TypeBytesStatic _ -> False
  TypeBytesDynamic -> True
  TypeString -> True
  TypeArrayStatic n ty -> n /= 0 && typeIsDynamic ty
  TypeArrayDynamic _ -> True

typeByteSize :: Type -> Maybe Int
typeByteSize = fmap (`div` 8) . typeBitSize

typeBitSize :: Type -> Maybe Int
typeBitSize = \case
  TypeBool -> return 8
  TypeUInt n -> return $ fromMaybe 256 n
  TypeInt n -> return $ fromMaybe 256 n
  TypeAddress -> return 160
  TypeBytesStatic n -> return $ 8 * n
  TypeBytesDynamic -> Nothing
  TypeString -> Nothing
  TypeArrayStatic len ty ->
    if len == 0 then return 0 else (len *) <$> typeBitSize ty
  TypeArrayDynamic _ -> Nothing

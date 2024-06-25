--this module is used to convert an EVM XABI to a partial Contract type (defined in SolidVM).  Since the XABI is missing a lot of the stuff in Contract, this conversion will always be incomplete, but the resulting type can be used anywhere that doesn't need the missing stuff.  This will allow us to unify some code that works with both solidvm and EVM
module BlockApps.Solidity.XabiContract
  ( indexedTypeToEvmIndexedType,
  )
where

import qualified BlockApps.Solidity.Xabi.Type as OLDXABI
import SelectAccessible ()
import SolidVM.Model.CodeCollection hiding (contractName, events)
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Type as SVMType

indexedTypeToEvmIndexedType :: IndexedType -> Maybe OLDXABI.IndexedType
indexedTypeToEvmIndexedType x =
  let mType = typeToEvmType $ indexedTypeType x
   in fmap
        ( \t ->
            OLDXABI.IndexedType
              { OLDXABI.indexedTypeIndex = indexedTypeIndex x,
                OLDXABI.indexedTypeType = t
              }
        )
        mType

typeToEvmType :: SVMType.Type -> Maybe OLDXABI.Type
typeToEvmType (SVMType.Int x y) = Just $ OLDXABI.Int x y
typeToEvmType (SVMType.String x) = Just $ OLDXABI.String x
typeToEvmType (SVMType.Bytes x y) = Just $ OLDXABI.Bytes x y
typeToEvmType SVMType.Bool = Just $ OLDXABI.Bool
typeToEvmType (SVMType.Address _) = Just $ OLDXABI.Address
typeToEvmType (SVMType.Account _) = Just $ OLDXABI.Account
typeToEvmType (SVMType.UnknownLabel x _) = Just $ OLDXABI.UnknownLabel x
typeToEvmType (SVMType.Struct x y) = Just $ OLDXABI.Struct x (labelToText y)
typeToEvmType (SVMType.Enum x y z) = Just $ OLDXABI.Enum x (labelToText y) (map labelToText <$> z)
typeToEvmType (SVMType.Array x y) = flip OLDXABI.Array y <$> typeToEvmType x
typeToEvmType (SVMType.Contract x) = Just $ OLDXABI.Contract (labelToText x)
typeToEvmType (SVMType.Mapping x y z) = OLDXABI.Mapping x <$> typeToEvmType y <*> typeToEvmType z
typeToEvmType (SVMType.Variadic) = Just $ OLDXABI.Variadic
typeToEvmType (SVMType.Decimal) = Just $ OLDXABI.Decimal
typeToEvmType _ = Nothing

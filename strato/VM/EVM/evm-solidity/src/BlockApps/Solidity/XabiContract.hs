--this module is used to convert an EVM XABI to a partial Contract type (defined in SolidVM).  Since the XABI is missing a lot of the stuff in Contract, this conversion will always be incomplete, but the resulting type can be used anywhere that doesn't need the missing stuff.  This will allow us to unify some code that works with both solidvm and EVM
module BlockApps.Solidity.XabiContract
  ( xabiToPartialContract,
    indexedTypeToEvmIndexedType,
  )
where

import qualified BlockApps.Solidity.Xabi as OLDXABI
import qualified BlockApps.Solidity.Xabi.Type as OLDXABI
import qualified Data.Map as M
import Data.Source.Annotation
import Data.Source.Position
import SelectAccessible ()
import SolidVM.Model.CodeCollection hiding (contractName, events)
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Type as SVMType

--I am leaving a lot of this undefined....  Partly because the values don't exist in a XABI,
--and partly just because we don't need some of these values yet.  If a dev uses one of these
--undefined values, the error messages will let them know something needs to be filled in.
xabiToPartialContract :: OLDXABI.Xabi -> Contract
xabiToPartialContract xabi =
  Contract
    { _contractName = error "_contractName undefined",
      _parents = error "_parents undefined",
      _constants = error "_constants undefined",
      _storageDefs = M.mapKeys textToLabel $ fmap varTypeToVariableDecl $ OLDXABI.xabiVars xabi,
      _userDefined = error "_userDefined undefined",
      _enums = error "_enums undefined",
      _structs = error "_structs undefined",
      _errors = error "_errors undefined",
      _events = M.mapKeys textToLabel $ fmap evmEventToEvent $ OLDXABI.xabiEvents xabi,
      _functions = error "_functions undefined",
      _constructor = error "_constructor undefined",
      _modifiers = error "_modifiers undefined",
      _usings = error "_usings undefined",
      _contractContext = error "_contractContext undefined",
      _contractType = error "_contractType undefined"
    }

evmEventToEvent :: OLDXABI.Event -> Event
evmEventToEvent e =
  Event
    { _eventAnonymous = OLDXABI.eventAnonymous e,
      _eventLogs = map (fmap evmIndexedTypeToIndexedType) $ OLDXABI.eventLogs e,
      _eventContext = dummyAnnotation
    }

evmIndexedTypeToIndexedType :: OLDXABI.IndexedType -> IndexedType
evmIndexedTypeToIndexedType x =
  IndexedType
    { indexedTypeIndex = OLDXABI.indexedTypeIndex x,
      indexedTypeType = evmTypeToType $ OLDXABI.indexedTypeType x
    }

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

evmTypeToType :: OLDXABI.Type -> SVMType.Type
evmTypeToType (OLDXABI.Int x y) = SVMType.Int x y
evmTypeToType (OLDXABI.String x) = SVMType.String x
evmTypeToType (OLDXABI.Bytes x y) = SVMType.Bytes x y
evmTypeToType OLDXABI.Bool = SVMType.Bool
evmTypeToType OLDXABI.Address = SVMType.Address False
evmTypeToType OLDXABI.Account = SVMType.Account False
evmTypeToType (OLDXABI.UnknownLabel x) = SVMType.UnknownLabel (stringToLabel x) Nothing
evmTypeToType (OLDXABI.Struct x y) = SVMType.Struct x $ textToLabel y
evmTypeToType (OLDXABI.Enum x y z) = SVMType.Enum x (textToLabel y) $ fmap (map textToLabel) z
evmTypeToType (OLDXABI.Array x y) = SVMType.Array (evmTypeToType x) y
evmTypeToType (OLDXABI.Contract x) = SVMType.Contract $ textToLabel x
evmTypeToType (OLDXABI.Mapping x y z) = SVMType.Mapping x (evmTypeToType y) (evmTypeToType z)

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
typeToEvmType _ = Nothing

varTypeToVariableDecl :: OLDXABI.VarType -> VariableDeclF (SourceAnnotation ())
varTypeToVariableDecl x =
  VariableDecl
    { _varType = evmTypeToType $ OLDXABI.varTypeType x,
      _varIsPublic = False,
      _varInitialVal = Nothing,
      _varContext = dummyAnnotation,
      _isImmutable = False,
      _isRecord = False
    }

dummyAnnotation :: SourceAnnotation ()
dummyAnnotation =
  SourceAnnotation
    { _sourceAnnotationStart =
        SourcePosition
          { _sourcePositionName = "",
            _sourcePositionLine = 0,
            _sourcePositionColumn = 0
          },
      _sourceAnnotationEnd =
        SourcePosition
          { _sourcePositionName = "",
            _sourcePositionLine = 0,
            _sourcePositionColumn = 0
          },
      _sourceAnnotationAnnotation = ()
    }

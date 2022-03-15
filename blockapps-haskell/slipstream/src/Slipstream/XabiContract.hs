

--this module is used to convert an EVM XABI to a partial Contract type (defined in SolidVM).  Since the XABI is missing a lot of the stuff in Contract, this conversion will always be incomplete, but the resulting type can be used anywhere that doesn't need the missing stuff.  This will allow us to unify some code that works with both solidvm and EVM
module Slipstream.XabiContract (
  xabiToPartialContract  
  ) where



import Data.Source.Annotation
import Data.Source.Position
import qualified BlockApps.Solidity.Xabi      as OLDXABI
import qualified BlockApps.Solidity.Xabi.Type as OLDXABI

import SelectAccessible                         ()

import SolidVM.Model.CodeCollection hiding (contractName, events)

import qualified SolidVM.Model.Type               as SVMType

--I am leaving a lot of this undefined....  Partly because the values don't exist in a XABI,
--and partly just because we don't need some of these values yet.  If a dev uses one of these
--undefined values, the error messages will let them know something needs to be filled in.
xabiToPartialContract :: OLDXABI.Xabi -> Contract
xabiToPartialContract xabi =
  Contract {
    _contractName=error "_contractName undefined",
    _parents=error "_parents undefined",
    _constants=error "_constants undefined",
    _storageDefs=fmap varTypeToVariableDecl $ OLDXABI.xabiVars xabi,
    _enums=error "_enums undefined",
    _structs=error "_structs undefined",
    _events=fmap evmEventToEvent $ OLDXABI.xabiEvents xabi,
    _functions=error "_functions undefined",
    _constructor=error "_constructor undefined",
    _vmVersion=error "_vmVersion undefined",
    _contractContext=error "_contractContext undefined"
    }

evmEventToEvent :: OLDXABI.Event -> Event
evmEventToEvent e = Event {
  eventAnonymous = OLDXABI.eventAnonymous e,
  eventLogs = map (fmap evmIndexedTypeToIndexedType) $ OLDXABI.eventLogs e,
  eventContext = dummyAnnotation
  }

evmIndexedTypeToIndexedType :: OLDXABI.IndexedType -> IndexedType
evmIndexedTypeToIndexedType x = IndexedType {
  indexedTypeIndex = OLDXABI.indexedTypeIndex x,
  indexedTypeType = evmTypeToType $ OLDXABI.indexedTypeType x
  }

evmTypeToType :: OLDXABI.Type -> SVMType.Type
evmTypeToType (OLDXABI.Int x y) = SVMType.Int x y
evmTypeToType (OLDXABI.String x) = SVMType.String x
evmTypeToType (OLDXABI.Bytes x y) = SVMType.Bytes x y
evmTypeToType OLDXABI.Bool = SVMType.Bool
evmTypeToType OLDXABI.Address = SVMType.Address
evmTypeToType OLDXABI.Account = SVMType.Account
evmTypeToType (OLDXABI.Label x) = SVMType.Label x
evmTypeToType (OLDXABI.Struct x y) = SVMType.Struct x y
evmTypeToType (OLDXABI.Enum x y z) = SVMType.Enum x y z
evmTypeToType (OLDXABI.Array x y) = SVMType.Array (evmTypeToType x) y
evmTypeToType (OLDXABI.Contract x) = SVMType.Contract x
evmTypeToType (OLDXABI.Mapping x y z) = SVMType.Mapping x (evmTypeToType y) (evmTypeToType z)

varTypeToVariableDecl :: OLDXABI.VarType -> VariableDeclF (SourceAnnotation ())
varTypeToVariableDecl x =
  VariableDecl {
  varType=evmTypeToType $ OLDXABI.varTypeType x,
  varIsPublic=False,
  varInitialVal=Nothing,
  varContext=dummyAnnotation
  }

dummyAnnotation :: SourceAnnotation ()
dummyAnnotation =
  SourceAnnotation
  {
    _sourceAnnotationStart=SourcePosition {
      _sourcePositionName="",
      _sourcePositionLine=0,
      _sourcePositionColumn=0
      },
    _sourceAnnotationEnd=SourcePosition {
      _sourcePositionName="",
        _sourcePositionLine=0,
        _sourcePositionColumn=0
      },
    _sourceAnnotationAnnotation = ()
  }


{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE RecordWildCards #-}

module Bloc.XabiHelper
  ( parseSolidXabi,
    transFormXabi,
  )
where

import BlockApps.Solidity.Parse.Parser
import qualified BlockApps.Solidity.Parse.ParserTypes as EVMParseT (SolcVersion (..))
import qualified BlockApps.Solidity.Xabi as EVMXabi
import qualified BlockApps.Solidity.Xabi.Def as XabiDef
import qualified BlockApps.Solidity.Xabi.Type as XabiType
import Control.Arrow ((***))
import Data.Int (Int32)
import qualified Data.Map as M
import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import qualified SolidVM.Model.CodeCollection.Def as SolidDef
import qualified SolidVM.Model.CodeCollection.Event as SolidEv
import qualified SolidVM.Model.CodeCollection.Function as SolidF
import qualified SolidVM.Model.CodeCollection.VarDef as CCVarfDef
import qualified SolidVM.Model.CodeCollection.VariableDecl as SolidVarDec
import qualified SolidVM.Model.Type as SolidType
import SolidVM.Solidity.Parse.Declarations
import SolidVM.Solidity.Parse.File
import SolidVM.Solidity.Parse.ParserTypes as SolidParseT
import qualified SolidVM.Solidity.Parse.UnParser as SolidUnparse
import qualified SolidVM.Solidity.Xabi as SVMXabi
import Text.Parsec hiding (parse)

parseSolidXabi :: SourceName -> SourceCode -> Either String (EVMParseT.SolcVersion, [(T.Text, EVMXabi.Xabi)])
parseSolidXabi sName sCode = do
  fi@(File parsedFile) <- showError $ runParser solidityFile initialParserState sName sCode
  let nameXabi = [(name, transFormXabi xabi) | NamedXabi name (xabi, _) <- parsedFile]
  let associatedEVMVersion = case decideVersion fi of
        SolidParseT.ZeroPointFour -> EVMParseT.ZeroPointFour
        SolidParseT.ZeroPointFive -> EVMParseT.ZeroPointFive
  return $! (associatedEVMVersion, nameXabi)

transFormXabi :: SVMXabi.Xabi -> EVMXabi.Xabi
transFormXabi SVMXabi.Xabi {..} =
  EVMXabi.Xabi
    { xabiFuncs = M.map tFormFunc $ M.mapKeysMonotonic T.pack _xabiFuncs,
      xabiConstr = case M.toList _xabiConstr of --Shouldn't _xabiConstr always be a size of 1?
        [] -> Nothing
        [(_, f)] -> Just $ tFormFunc f
        _ -> Just $ tFormFunc $ snd $ head $ M.toList _xabiConstr, --I don't think this should ever run
      xabiVars = M.map tFormVarDeclToVartype $ M.mapKeysMonotonic T.pack _xabiVars,
      xabiTypes = M.map tFormDef $ M.mapKeysMonotonic T.pack _xabiTypes,
      xabiModifiers = M.map tFormModifer $ M.mapKeysMonotonic T.pack _xabiModifiers,
      xabiEvents = M.map tFormEv $ M.mapKeysMonotonic T.pack _xabiEvents,
      xabiKind = case _xabiKind of SVMXabi.ContractKind -> EVMXabi.ContractKind; SVMXabi.InterfaceKind -> EVMXabi.InterfaceKind; SVMXabi.AbstractKind -> EVMXabi.AbstractKind; SVMXabi.LibraryKind -> EVMXabi.LibraryKind,
      xabiUsing = M.fromList . map (T.pack *** tFormUs) $ M.toList _xabiUsing
    }

----------------------------------
--General helper functions for transforming Xabi
----------------------------------
tFormFunc :: SolidF.Func -> EVMXabi.Func
tFormFunc SolidF.Func {..} =
  EVMXabi.Func
    { funcArgs = M.fromList [(T.pack $ fromMaybe "" a, tFormIndexedType b) | (a, b) <- (_funcArgs)], --Map Text Xabi.IndexedType
      funcVals = M.fromList [(T.pack $ fromMaybe "" a, tFormIndexedType b) | (a, b) <- (_funcVals)], --Map Text Xabi.IndexedType
      funcStateMutability = case _funcStateMutability of
        Nothing -> Nothing
        Just SolidF.Pure -> Just EVMXabi.Pure
        Just SolidF.Constant -> Just EVMXabi.Constant
        Just SolidF.View -> Just EVMXabi.View
        Just SolidF.Payable -> Just EVMXabi.Payable,
      funcContents = case _funcContents of
        Nothing -> Nothing
        Just [] -> Nothing --Not 100% if this is a correct translastion
        Just contents -> Just $ T.pack $ foldl (++) "" (map SolidUnparse.unparseStatement contents), -- Maybe Text
      funcVisibility = case _funcVisibility of
        Nothing -> Nothing
        Just SolidF.Private -> Just EVMXabi.Private
        Just SolidF.Public -> Just EVMXabi.Public
        Just SolidF.Internal -> Just EVMXabi.Internal
        Just SolidF.External -> Just EVMXabi.External, -- Maybe Visibility
      funcModifiers = case _funcModifiers of
        [] -> Nothing --Not 100% if this is a correct translastion TODO
        contents ->
          Just $
            map
              ( \case
                  (_, [e]) -> SolidUnparse.unparseExpression e
                  _ -> error "tFormFunc: funcModifiers: unexpected case"
              )
              contents -- Maybe [String]
    }

tFormVarDeclToVartype :: SolidVarDec.VariableDecl -> XabiType.VarType
tFormVarDeclToVartype SolidVarDec.VariableDecl {..} =
  XabiType.VarType
    { varTypeAtBytes = 0 :: Int32, --TODO --> change this to ?
      varTypePublic = Just _varIsPublic,
      varTypeConstant = Nothing,
      varTypeInitialValue = case _varInitialVal of
        Nothing -> Nothing --Not 100% if this is a correct translastion
        Just contents -> Just $ SolidUnparse.unparseExpression contents,
      varTypeType = tFormTypeToType _varType
    }

tFormDef :: SolidDef.Def -> XabiDef.Def
tFormDef (SolidDef.Enum nam byte _) = (XabiDef.Enum (map T.pack nam) byte)
tFormDef (SolidDef.Struct fields byte _) = (XabiDef.Struct (map (\(x, y) -> (T.pack x, tFormFieldType y)) fields) byte)
tFormDef (SolidDef.Contract bytes _) = XabiDef.Contract bytes
tFormDef (SolidDef.Error params byte _) = (XabiDef.Struct (map (\(x, (CCVarfDef.IndexedType z y)) -> (T.pack x, XabiType.FieldType z $ tFormTypeToType y)) params) byte) --  { params :: [(SolidString, SolidVM.IndexedType)], bytes::Word, context :: a }

tFormFieldType :: CCVarfDef.FieldType -> XabiType.FieldType
tFormFieldType (CCVarfDef.FieldType x typ) = XabiType.FieldType x (tFormTypeToType typ)

tFormModifer :: SolidF.Modifier -> EVMXabi.Modifier
tFormModifer SolidF.Modifier {..} =
  EVMXabi.Modifier
    { modifierArgs = M.fromList $ fmap tFormIndexedType <$> _modifierArgs,
      modifierSelector = _modifierSelector,
      modifierVals = M.empty, -- :: Map Text Xabi.IndexedType __TODO!!!!
      modifierContents = case _modifierContents of
        Nothing -> Nothing
        Just contents -> Just $ T.pack $ foldl (++) "" $ map SolidUnparse.unparseStatement contents -- WHat is a better way of doing this?
    }

tFormEv :: SolidEv.Event -> EVMXabi.Event
tFormEv SolidEv.Event {..} =
  EVMXabi.Event
    { eventAnonymous = _eventAnonymous,
      eventLogs = [(a, tFormIndexedType b) | SolidEv.EventLog a _ b <- _eventLogs]
    }

tFormUs :: [SVMXabi.Using] -> EVMXabi.Using
tFormUs [] = EVMXabi.Using $ "for nothing, apparently"
tFormUs (SVMXabi.Using _ t _ : _) = EVMXabi.Using $ "for " ++ t -- weird legacy code

tFormIndexedType :: CCVarfDef.IndexedType -> XabiType.IndexedType
tFormIndexedType (CCVarfDef.IndexedType x y) = XabiType.IndexedType x (tFormTypeToType y)

tFormTypeToType :: SolidType.Type -> XabiType.Type
tFormTypeToType = \case
  (SolidType.Int maybeBool maybeBytes) -> (XabiType.Int maybeBool maybeBytes)
  (SolidType.String maybeBool) -> (XabiType.String maybeBool)
  (SolidType.Bytes maybeBool maybeBytes) -> (XabiType.Bytes maybeBool maybeBytes)
  (SolidType.UnknownLabel a _) -> (XabiType.UnknownLabel a)
  (SolidType.Struct maybeInt typeD) -> (XabiType.Struct maybeInt $ T.pack typeD)
  (SolidType.Enum maybeInt typeD nams) -> (XabiType.Enum maybeInt (T.pack typeD) ((map T.pack) <$> nams))
  (SolidType.Array typ len) -> (XabiType.Array (tFormTypeToType typ) len)
  (SolidType.Contract s) -> (XabiType.Contract $ T.pack s)
  (SolidType.Mapping maybeBoo k v) -> (XabiType.Mapping maybeBoo (tFormTypeToType k) (tFormTypeToType v))
  (SolidType.UserDefined _ t) -> tFormTypeToType t
  (SolidType.Bool) -> (XabiType.Bool)
  (SolidType.Address _) -> (XabiType.Address)
  (SolidType.Account _) -> (XabiType.Account)
  SolidType.Decimal -> XabiType.Decimal
  (SolidType.Error _ ss) -> (XabiType.UnknownLabel ss) --Questionable at best
  SolidType.Variadic -> XabiType.Variadic

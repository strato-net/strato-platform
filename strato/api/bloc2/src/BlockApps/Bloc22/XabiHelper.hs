{-# LANGUAGE  RecordWildCards    #-}
{-# LANGUAGE LambdaCase          #-}


module BlockApps.Bloc22.XabiHelper
  ( parseSolidXabi
  , transFormXabi
  ) where
import           BlockApps.Solidity.Parse.Parser


import           Data.Int                                  (Int32)
import qualified Data.Map                                  as M
import qualified Data.Text                                 as T
import           Text.Parsec                               hiding (parse)


import qualified BlockApps.Solidity.Parse.ParserTypes      as EVMParseT (SolcVersion(..)) 
import           SolidVM.Solidity.Parse.ParserTypes        as SolidParseT

import qualified BlockApps.Solidity.Xabi                   as EVMXabi  
import qualified SolidVM.Solidity.Xabi                     as SVMXabi

import qualified SolidVM.Model.Type                        as SolidType
import qualified BlockApps.Solidity.Xabi.Type              as XabiType

import qualified BlockApps.Solidity.Xabi.Def               as XabiDef

import qualified SolidVM.Model.CodeCollection.VarDef       as CCVarfDef
import qualified SolidVM.Model.CodeCollection.Function     as SolidF
import qualified SolidVM.Model.CodeCollection.VariableDecl as SolidVarDec
import qualified SolidVM.Model.CodeCollection.Def          as SolidDef 
import qualified SolidVM.Model.CodeCollection.Event        as SolidEv

import           SolidVM.Solidity.Parse.Declarations
import qualified SolidVM.Solidity.Parse.File               as SParse
import qualified SolidVM.Solidity.Parse.UnParser           as SolidUnparse 

import           SolidVM.Model.SolidString


parseSolidXabi :: SourceName -> SourceCode ->  Either String (EVMParseT.SolcVersion,  [(T.Text, EVMXabi.Xabi)] )
parseSolidXabi sName sCode = do
  --SHould this be a a showError or something else?
  fi@(File parsedFile) <-  showError $ runParser SParse.solidityFile (ParserState "" "" M.empty) sName sCode
  let nameXabi = [(name, transFormXabi xabi) |  NamedXabi name (xabi, _) <- parsedFile] 
  let associatedEVMVersion = case decideVersion fi of
            SolidParseT.ZeroPointFour -> EVMParseT.ZeroPointFour 
            SolidParseT.ZeroPointFive -> EVMParseT.ZeroPointFive
  return $! (associatedEVMVersion, nameXabi)

   
transFormXabi :: SVMXabi.Xabi -> EVMXabi.Xabi 
transFormXabi SVMXabi.Xabi{..} =  
  EVMXabi.Xabi { xabiFuncs   = M.map tFormFunc $ M.mapKeysMonotonic T.pack _xabiFuncs  -- M.fromList [ (T.pack ss,  tFormFunc f) |(ss, f)<- (M.toList _xabiFuncs)]
             , xabiConstr    = case M.toList _xabiConstr of --Shouldn't _xabiConstr always be a size of 1?
                            [] -> Nothing
                            [(_, f)] -> Just $ tFormFunc f
                            _ -> Just $ tFormFunc $ snd $ head $ M.toList _xabiConstr --I don't think this should ever run
             , xabiVars      = M.map tFormVarDeclToVartype $ M.mapKeysMonotonic T.pack _xabiVars  --M.fromList [ (T.pack ss,  tFormVarDeclToVartype f) |(ss, f)<- (M.toList _xabiVars)]
             , xabiTypes     = M.fromList  [ (t, def) |(t, Just def) <- [ (T.pack ss,  tFormDef f) | (ss, f) <- (M.toList _xabiTypes)]]
             , xabiModifiers = M.map tFormModifer $ M.mapKeysMonotonic T.pack _xabiModifiers  --M.fromList   [ (T.pack ss,  tFormModifer m) | (ss, m) <- (M.toList _xabiModifiers)]
             , xabiEvents    = M.map tFormEv $ M.mapKeysMonotonic T.pack _xabiEvents --M.fromList   [ (T.pack ss,  tFormEv m) | (ss, m) <- (M.toList _xabiEvents)]
             , xabiKind      = case _xabiKind of SVMXabi.ContractKind -> EVMXabi.ContractKind ; SVMXabi.InterfaceKind-> EVMXabi.InterfaceKind; SVMXabi.LibraryKind ->  EVMXabi.LibraryKind;
             , xabiUsing     = M.map tFormUs _xabiUsing
           }


----------------------------------
--General Helper functions for transforming
--each part of the Xabi
----------------------------------
tFormFunc :: SolidF.Func -> EVMXabi.Func
tFormFunc SolidF.Func{..} = EVMXabi.Func {      
  funcArgs   = M.fromList [ (tformMaybeSoldStringToText a, tFormIndexedType b) |(a, b)<- (_funcArgs)]  --Map Text Xabi.IndexedType
  , funcVals = M.fromList [ (tformMaybeSoldStringToText a, tFormIndexedType b) |(a, b)<- (_funcVals)]  --Map Text Xabi.IndexedType
  , funcStateMutability = case _funcStateMutability of 
                          Nothing -> Nothing;
                          Just SolidF.Pure     -> Just EVMXabi.Pure
                          Just SolidF.Constant -> Just EVMXabi.Constant
                          Just SolidF.View     -> Just EVMXabi.View
                          Just SolidF.Payable  -> Just EVMXabi.Payable
  , funcContents = case _funcContents of  
                          Nothing -> Nothing; 
                          Just [] -> Nothing; --Not 100% if this is a correct translastion
                          Just contents -> Just $ T.pack $ foldl (++) "" (map SolidUnparse.unparseStatement contents); -- Maybe Text
  , funcVisibility = case _funcVisibility of 
                          Nothing -> Nothing;
                          Just SolidF.Private     -> Just EVMXabi.Private
                          Just SolidF.Public      -> Just EVMXabi.Public
                          Just SolidF.Internal    -> Just EVMXabi.Internal
                          Just SolidF.External    -> Just EVMXabi.External -- Maybe Visibility
  , funcModifiers =  case _funcModifiers of 
                          [] -> Nothing --Not 100% if this is a correct translastion TODO
                          contents -> Just $ map (\(_, [e])->  SolidUnparse.unparseExpression e  ) contents -- Maybe [String]
  }


tFormVarDeclToVartype :: SolidVarDec.VariableDecl -> XabiType.VarType
tFormVarDeclToVartype    SolidVarDec.VariableDecl{..} = XabiType.VarType { 
  varTypeAtBytes        = 0 ::Int32 --TODO --> change this to ?
  , varTypePublic       = Just _varIsPublic
  , varTypeConstant     = Nothing 
  , varTypeInitialValue =   case _varInitialVal of 
                          Nothing -> Nothing --Not 100% if this is a correct translastion
                          Just contents -> Just $  SolidUnparse.unparseExpression contents 
  , varTypeType         = tFormTypeToType _varType
  }


tFormDef :: SolidDef.Def -> Maybe XabiDef.Def
tFormDef (SolidDef.Enum nam byte _)      = Just $ (XabiDef.Enum (map T.pack nam) byte)
tFormDef (SolidDef.Struct fields byte _) = Just $ (XabiDef.Struct  (map (\(x, y)-> (T.pack x,  tFormFieldType y) ) fields)  byte)
tFormDef (SolidDef.Contract bytes _)     = Just $ XabiDef.Contract bytes
tFormDef      _                          = Nothing


tFormFieldType :: CCVarfDef.FieldType -> XabiType.FieldType
tFormFieldType (CCVarfDef.FieldType x typ) = XabiType.FieldType x (tFormTypeToType typ)


tFormModifer :: SolidF.Modifier -> EVMXabi.Modifier
tFormModifer SolidF.Modifier{..} = EVMXabi.Modifier{
    modifierArgs       = M.map tFormIndexedType _modifierArgs-- M.fromList [ (a, tFormIndexedType b) |(a, b)<- (M.toList _modifierArgs)] -- :: Map Text Xabi.IndexedType
    , modifierSelector = _modifierSelector 
    , modifierVals     = M.empty -- :: Map Text Xabi.IndexedType __TODO!!!!
    , modifierContents = case _modifierContents of 
                            Nothing         -> Nothing
                            Just contents   -> Just $ T.pack $ foldl (++) "" $ map SolidUnparse.unparseStatement   contents -- WHat is a better way of doing this?                          
}


tFormEv :: SolidEv.Event -> EVMXabi.Event
tFormEv SolidEv.Event{..}= EVMXabi.Event {
      eventAnonymous =  _eventAnonymous
      , eventLogs    =  [ ( a, tFormIndexedType b) | (a, b) <- _eventLogs]  
}


tFormUs:: SVMXabi.Using ->  EVMXabi.Using
tFormUs (SVMXabi.Using a _) = EVMXabi.Using a


----------------------------------
--General Helper Function Section
----------------------------------
tformMaybeSoldStringToText :: Maybe SolidString -> T.Text
tformMaybeSoldStringToText x = case x of 
  Just st -> T.pack st
  Nothing -> T.pack ""  

tFormIndexedType :: CCVarfDef.IndexedType -> XabiType.IndexedType
tFormIndexedType (CCVarfDef.IndexedType x y) = XabiType.IndexedType x (tFormTypeToType y)


tFormTypeToType :: SolidType.Type -> XabiType.Type
tFormTypeToType = \case 
  (SolidType.Int maybeBool maybeBytes)    ->  (XabiType.Int maybeBool maybeBytes)
  (SolidType.String maybeBool)            ->  (XabiType.String maybeBool)
  (SolidType.Bytes maybeBool maybeBytes)  ->  (XabiType.Bytes maybeBool maybeBytes)
  (SolidType.UnknownLabel  a _)           ->  (XabiType.UnknownLabel a )
  (SolidType.Struct  maybeInt typeD )     ->  (XabiType.Struct maybeInt $ T.pack typeD )
  (SolidType.Enum  maybeInt typeD nams)   ->  (XabiType.Enum maybeInt (T.pack typeD) ( (map T.pack) <$> nams) )
  (SolidType.Array  typ len)              ->  (XabiType.Array (tFormTypeToType typ) len)
  (SolidType.Contract  s)                 ->  (XabiType.Contract $ T.pack s)
  (SolidType.Mapping  maybeBoo k v)       ->  (XabiType.Mapping maybeBoo (tFormTypeToType k) (tFormTypeToType v))
  (SolidType.UserDefined   _ t)           ->  tFormTypeToType t
  (SolidType.Bool)                        ->  (XabiType.Bool)
  (SolidType.Address _)                   ->  (XabiType.Address)
  (SolidType.Account _)                   ->  (XabiType.Account)
  _ -> (XabiType.Int Nothing Nothing)  -- !!!!! TODO FIX THIS, THIS IS NOT WHAT SHOULD BE DONE HERE!

--THE BELOW ARE SOLIDVM types that I was not sure how to map over
-- data Type
--   | Fixed {signed::Maybe Bool, decimals::Maybe (Int32,Int32)}
--   | Error { bytes::Maybe Int32, typedef::SolidString }
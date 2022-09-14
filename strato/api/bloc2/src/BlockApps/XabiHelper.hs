{-# LANGUAGE  RecordWildCards    #-}
{-# LANGUAGE LambdaCase          #-}


module BlockApps.XabiHelper
  ( hideFucn
  , hideFucn2
  , transFormXabi
  ) where


import           Data.Int                                  (Int32)
import qualified Data.Map                                  as M
import qualified Data.Text                                 as T
import           Text.Parsec                               hiding (parse)


import qualified BlockApps.Solidity.Parse.ParserTypes      as EVMParseT (SolcVersion(..)) 
import           SolidVM.Solidity.Parse.ParserTypes        hiding (SolidityValue)

import qualified BlockApps.Solidity.Xabi                   as EVMXabi  
import qualified SolidVM.Solidity.Xabi                     as SVMXabi

import qualified SolidVM.Model.Type                        as SolidType
import qualified BlockApps.Solidity.Xabi.Type              as XabiType


import qualified SolidVM.Model.CodeCollection.VarDef       as CCVarfDef
import qualified SolidVM.Model.CodeCollection.Function     as SolidF
import qualified SolidVM.Model.CodeCollection.VariableDecl as SolidVarDec

import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.File
import qualified SolidVM.Solidity.Parse.UnParser           as  SolidUnparse 
import           SolidVM.Model.SolidString



--import qualified Data.Binary.Builder as M


--An Expeirment by Garrett
hideFucn :: SourceName -> SourceCode ->   [(T.Text, EVMXabi.Xabi)]
hideFucn x y = do
  File parsedFile <- case runParser solidityFile (ParserState "" "" M.empty) x y of Left _ -> []; Right xx-> [xx];
  --parsedFile1 <- --either (die . show) return $ runParser solidityFile (ParserState "" "" M.empty) x y
  [(name, transFormXabi xabi) |  NamedXabi name (xabi, _) <- parsedFile]
  --[(name, xabi) |  NamedXabi name (xabi, parents') <- parsedFile]

hideFucn2 ::  SourceName -> SourceCode -> (EVMParseT.SolcVersion,  [(T.Text, EVMXabi.Xabi)] )
hideFucn2 x  y= (EVMParseT.ZeroPointFour, (hideFucn x y))



transFormXabi :: SVMXabi.Xabi -> EVMXabi.Xabi 
transFormXabi SVMXabi.Xabi{..} =  
  EVMXabi.Xabi { xabiFuncs =  M.fromList [ (T.pack ss,  tFormFunc f) |(ss, f)<- (M.toList _xabiFuncs)]--M.singleton (T.pack "Test") 
             --Clean this up case _xabiConstr of M.empty -> Nothing;  
             , xabiConstr = case M.toList _xabiConstr of --Shouldn't _xabiConstr always be a size of 1?
                            [] -> Nothing
                            [(_, f)] -> Just $ tFormFunc f
                            _ -> Just $ tFormFunc $ snd $ head $ M.toList _xabiConstr --I don't think this should ever run
              --Map SolidString (VariableDeclF a) -> Map Text Xabi.VarType
             , xabiVars = M.fromList [ (T.pack ss,  tFormVarDeclToVartype f) |(ss, f)<- (M.toList _xabiVars)] --TODO
             , xabiTypes = M.empty --TODO
             , xabiModifiers = M.empty --TODO
             , xabiEvents = M.empty --TODO
             , xabiKind = EVMXabi.ContractKind --TODO
             , xabiUsing = M.empty --TODO
           }


----------------------------------
--Transforming SolidFuncs to Xabi Funcs Section
----------------------------------
tFormFunc :: SolidF.Func -> EVMXabi.Func
tFormFunc SolidF.Func{..} = EVMXabi.Func {      
  funcArgs   = M.fromList [ (tformMaybeSoldStringToText a, tFormIndexedType b) |(a, b)<- (_funcArgs)]      --Map Text Xabi.IndexedType
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
                          [] -> Nothing --Not 100% if this is a correct translastion
                          contents -> Just $ map (\(_, [e])->  SolidUnparse.unparseExpression e  ) contents -- Maybe [String]
  }




----------------------------------
----VarDecl -> Vartype Section
----------------------------------
tFormVarDeclToVartype :: SolidVarDec.VariableDecl -> XabiType.VarType
tFormVarDeclToVartype    SolidVarDec.VariableDecl{..} = XabiType.VarType { 
  varTypeAtBytes        = 0 ::Int32 --TODO change this      -- :: Int32
  , varTypePublic       = Just _varIsPublic        -- :: Maybe Bool
  , varTypeConstant     = Nothing   -- :: Maybe String
  , varTypeInitialValue =   case _varInitialVal of 
                          Nothing -> Nothing --Not 100% if this is a correct translastion
                          Just contents -> Just $  SolidUnparse.unparseExpression contents -- Maybe [String]-- :: Maybe String
  , varTypeType         = tFormTypeToType _varType        -- :: Type
  }
-- data VariableDeclF a = VariableDecl
--   { _varType       :: SVMType.Type
--   , _varIsPublic   :: Bool
--   , _varInitialVal :: Maybe (ExpressionF a)
--   , _varContext    :: a
--   , _isImmutable   :: Bool
--   } 



----------------------------------
--General Helper Function Section
----------------------------------
tformMaybeSoldStringToText :: Maybe SolidString -> T.Text
tformMaybeSoldStringToText x = case x of 
  Just st -> T.pack st
  Nothing -> T.pack ""  

tFormIndexedType :: CCVarfDef.IndexedType -> XabiType.IndexedType
tFormIndexedType (CCVarfDef.IndexedType x y) = XabiType.IndexedType x (tFormTypeToType y)


--TODO fill this out......
tFormTypeToType :: SolidType.Type -> XabiType.Type
tFormTypeToType = \case 
  (SolidType.Int maybeBool maybeBytes) ->  (XabiType.Int maybeBool maybeBytes)  -- Int {signed::Maybe Bool, bytes::Maybe Int32} ->
  _ -> (XabiType.Int Nothing Nothing)
  -- | String {dynamic::Maybe Bool}
  -- | Bytes {dynamic::Maybe Bool, bytes:: Maybe Int32}
  -- | Fixed {signed::Maybe Bool, decimals::Maybe (Int32,Int32)}
  -- | Bool
  -- | Address {isPayable :: Bool}
  -- | Account {isPayable :: Bool}
  -- | UnknownLabel SolidString (Maybe SolidString)
  -- | Struct { bytes::Maybe Int32, typedef::SolidString}
  -- | UserDefined { alias ::  SolidString, actual:: Type}
  -- | Enum { bytes::Maybe Int32, typedef::SolidString, names::Maybe [SolidString]}
  -- | Error { bytes::Maybe Int32, typedef::SolidString }
  -- | Array { entry:: Type, length :: Maybe Word }
  -- | Contract {typedef::SolidString}
  -- | Mapping {dynamic::Maybe Bool, key::Type, value::Type}



---TODO Clean up
---NOT USING AT THE MOMENT
-- ---SO I am Commenting them out
-- removeMaybeBool :: Maybe Bool -> Bool 
-- removeMaybeBool = \case {Just a -> a; Nothing -> False; }


-- removeMaybeInt :: Maybe Int32 -> Int32 
-- removeMaybeInt = \case {Just a -> a; Nothing -> 0; }
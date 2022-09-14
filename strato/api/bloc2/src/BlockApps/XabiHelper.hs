{-# LANGUAGE  RecordWildCards    #-}
{-# LANGUAGE LambdaCase          #-}


module BlockApps.XabiHelper
  ( hideFucn
  , hideFucn2
  , transFormXabi
  ) where



import qualified Data.Map as M
import qualified Data.Text as T


import qualified BlockApps.Solidity.Parse.ParserTypes as EVMParseT (SolcVersion(..)) 

import qualified SolidVM.Solidity.Parse.UnParser        as  SolidUnparse 

import           Text.Parsec                          hiding (parse)

import qualified BlockApps.Solidity.Xabi                 as EVMXabi  
import qualified BlockApps.Solidity.Xabi.Type            as XabiType
-- BlockApps.Solidity.Type
import qualified SolidVM.Model.Type                      as SolidType
import qualified SolidVM.Model.CodeCollection.VarDef     as CCVarfDef
import qualified SolidVM.Model.CodeCollection.Function   as SolidF
import qualified SolidVM.Solidity.Xabi                   as SVMXabi

--import           Data.Int                  (Int32)

import           SolidVM.Solidity.Parse.Declarations
import           SolidVM.Solidity.Parse.File
import           SolidVM.Solidity.Parse.ParserTypes hiding (SolidityValue)



import           SolidVM.Model.SolidString



--import qualified Data.Binary.Builder as M


--An Expeirment by Garrett
hideFucn :: SourceName -> SourceCode ->   [(T.Text, EVMXabi.Xabi)]
hideFucn x y = do
  File parsedFile <- case runParser solidityFile (ParserState "" "" M.empty) x y of Left _ -> []; Right xx-> [xx];

  --parsedFile1 <- --either (die . show) return $ runParser solidityFile (ParserState "" "" M.empty) x y
  --parsedFile <- hlepr
  [(name, transFormXabi xabi) |  NamedXabi name (xabi, _) <- parsedFile]
  --[(name, xabi) |  NamedXabi name (xabi, parents') <- parsedFile]

hideFucn2 ::  SourceName -> SourceCode -> (EVMParseT.SolcVersion,  [(T.Text, EVMXabi.Xabi)] )
hideFucn2 x  y= (EVMParseT.ZeroPointFour, (hideFucn x y))

transFormXabi :: SVMXabi.Xabi -> EVMXabi.Xabi 
transFormXabi SVMXabi.Xabi{..} =  
  EVMXabi.Xabi { xabiFuncs =  M.fromList [ (T.pack ss,  tFormFunc f) |(ss, f)<- (M.toList _xabiFuncs)]--M.singleton (T.pack "Test") 
             , xabiConstr = Nothing
             , xabiVars = M.empty
             , xabiTypes = M.empty
             , xabiModifiers = M.empty
             , xabiEvents = M.empty
             , xabiKind = EVMXabi.ContractKind
             , xabiUsing = M.empty
           }



--Transforming SolidFuncs to Xabi Funcs
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
                          Nothing -> Nothing; 
                          Just [] -> Nothing; --Not 100% if this is a correct translastion
                          Just contents -> Just $ T.pack $ foldl (++) "" (map SolidUnparse.unparseExpression contents); -- Maybe [String]
  }




tformMaybeSoldStringToText :: Maybe SolidString -> T.Text
tformMaybeSoldStringToText x = case x of 
  Just st -> T.pack st
  Nothing -> T.pack ""  

tFormIndexedType :: CCVarfDef.IndexedType -> XabiType.IndexedType
tFormIndexedType (CCVarfDef.IndexedType x y) = XabiType.IndexedType x (tFormTypeToType y)

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
{-#
  LANGUAGE
    RecordWildCards
#-}


module BlockApps.XAbiConverter where

import qualified Data.Map as Map
--import Data.Text (Text)

import BlockApps.Solidity
import BlockApps.Solidity.Contract
import BlockApps.Solidity.Struct
--import BlockApps.Solidity.Type
import BlockApps.Solidity.TypeDefs
--import qualified BlockApps.Storage as Storage

--xabiFuncs=undefined
--xabiConstr=undefined
--xabiVars=undefined



{-fieldsToStruct::TypeDefs->[(Text, Type)]->Struct
fieldsToStruct typeDefs' vars =
  let
    (positionAfter, positions) = addPositions typeDefs' (Storage.positionAt 0)
                                 $ map snd vars
  in
   Struct {
     fields=Map.fromList
            $ zipWith (\(n, t) p -> (n, (p, t))) vars positions,
     size = fromIntegral $ 32 * Storage.offset positionAfter + fromIntegral (Storage.byte positionAfter)
     }-}



xAbiToContract::Xabi->Contract
xAbiToContract Xabi{..} =
  let
    typeDefs' = TypeDefs{enumDefs=Map.fromList [], structDefs=Map.fromList []}
  in
   Contract{
     mainStruct=Struct{fields=Map.fromList [], size=0}, -- fieldsToStruct typeDefs' xabiVars, --  
     typeDefs=typeDefs'
     }


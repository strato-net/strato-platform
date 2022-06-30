module BlockApps.Bloc22.Database.Tables where

import Data.Profunctor.Product
import Opaleye

contractsSourceTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGBytea
  , Column PGText
  )
  ( Column PGInt4
  , Column PGBytea
  , Column PGText
  )
contractsSourceTable = Table "contracts_source" $ p3
  ( optionalTableField "id"
  , requiredTableField "src_hash"
  , requiredTableField "src"
  )

evmContractNameTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGBytea
  , Column PGText
  , Column PGBytea
  )
  ( Column PGInt4
  , Column PGBytea
  , Column PGText
  , Column PGBytea
  )
evmContractNameTable = Table "evm_contract_name" $ p4
  ( optionalTableField "id"
  , requiredTableField "code_hash"
  , requiredTableField "contract_name"
  , requiredTableField "src_hash"
  )

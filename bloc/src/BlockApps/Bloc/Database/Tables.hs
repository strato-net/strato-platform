module BlockApps.Bloc.Database.Tables where

import Data.Profunctor.Product
import Opaleye

usersTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGText
  )
  ( Column PGInt4
  , Column PGText
  )
usersTable = Table "users" $ p2
  ( optional "id"
  , required "name"
  )

keyStoreTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGInt4
  )
  ( Column PGInt4
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGInt4
  )
keyStoreTable = Table "keystore" $ p8
  ( optional "id"
  , required "salt"
  , required "password_hash"
  , required "nonce"
  , required "enc_sec_key"
  , required "pub_key"
  , required "address"
  , required "user_id"
  )

contractsTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGText
  )
  ( Column PGInt4
  , Column PGText
  )
contractsTable = Table "contracts" $ p2
  ( optional "id"
  , required "name"
  )

contractsMetaDataTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  )
  ( Column PGInt4
  , Column PGInt4
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  )
contractsMetaDataTable = Table "contracts_metadata" $ p6
  ( optional "id"
  , required "contract_id"
  , required "bin"
  , required "bin_runtime"
  , required "bin_runtime_hash"
  , required "code_hash"
  )

contractsInstanceTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  , Column PGBytea
  , Column PGTimestamptz
  )
  ( Column PGInt4
  , Column PGInt4
  , Column PGBytea
  , Column PGTimestamptz
  )
contractsInstanceTable = Table "contracts_instance" $ p4
  ( optional "id"
  , required "contract_metadata_id"
  , required "address"
  , required "timestamp"
  )

contractsLookupTable :: Table
  ( Column PGInt4
  , Column PGInt4
  )
  ( Column PGInt4
  , Column PGInt4
  )
contractsLookupTable = Table "contracts_lookup" $ p2
  ( required "contract_metadata_id"
  , required "linked_metadata_id"
  )

xabiFunctionsTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  , Column PGBool
  , Column (Nullable PGText)
  , Column (Nullable PGBytea)
  )
  ( Column PGInt4
  , Column PGInt4
  , Column PGBool
  , Column (Nullable PGText)
  , Column (Nullable PGBytea)
  )
xabiFunctionsTable = Table "xabi_functions" $ p5
  ( optional "id"
  , required "contract_metadata_id"
  , required "is_constructor"
  , required "name"
  , required "selector"
  )

xabiTypesTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGText
  , Column (Nullable PGText)
  , Column PGBool
  , Column PGBool
  , Column PGBool
  , Column (Nullable PGInt4)
  , Column PGInt4
  , Column PGInt4
  , Column PGInt4
  )
  ( Column PGInt4
  , Column PGText
  , Column (Nullable PGText)
  , Column PGBool
  , Column PGBool
  , Column PGBool
  , Column (Nullable PGInt4)
  , Column PGInt4
  , Column PGInt4
  , Column PGInt4
  )
xabiTypesTable = Table "xabi_types" $ p10
  ( optional "id"
  , required "type"
  , required "typedef"
  , required "is_dynamic"
  , required "is_signed"
  , required "is_public"
  , required "bytes"
  , required "entry_type_id"
  , required "value_type_id"
  , required "key_type_id"
  )

xabiFunctionArgumentsTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  , Column PGInt4
  , Column (Nullable PGText)
  , Column PGInt4
  )
  ( Column PGInt4
  , Column PGInt4
  , Column PGInt4
  , Column (Nullable PGText)
  , Column PGInt4
  )
xabiFunctionArgumentsTable = Table "xabi_function_arguments" $ p5
  ( optional "id"
  , required "function_id"
  , required "type_id"
  , required "name"
  , required "index"
  )

xabiFunctionReturnsTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  , Column PGInt4
  , Column PGInt4
  )
  ( Column PGInt4
  , Column PGInt4
  , Column PGInt4
  , Column PGInt4
  )
xabiFunctionReturnsTable = Table "xabi_function_returns" $ p4
  ( optional "id"
  , required "function_id"
  , required "index"
  , required "type_id"
  )

xabiVariablesTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  , Column PGInt4
  , Column PGText
  , Column PGInt4
  )
  ( Column PGInt4
  , Column PGInt4
  , Column PGInt4
  , Column PGText
  , Column PGInt4
  )
xabiVariablesTable = Table "xabi_variables" $ p5
  ( optional "id"
  , required "contract_metadata_id"
  , required "type_id"
  , required "name"
  , required "at_bytes"
  )

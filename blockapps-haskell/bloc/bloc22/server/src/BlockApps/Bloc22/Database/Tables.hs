module BlockApps.Bloc22.Database.Tables where

import Data.Profunctor.Product
import Opaleye

schemaVersionTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  )
  ( Column PGInt4
  , Column PGInt4
  )
schemaVersionTable = Table "bloc_schema_version" $ p2
  ( optional "id"
  , required "schema_version"
  )

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

hashNameTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGBytea
  , Column PGInt4
  , Column PGInt4
  , Column PGText
  )
  ( Column PGInt4
  , Column PGBytea
  , Column PGInt4
  , Column PGInt4
  , Column PGText
  )
hashNameTable = Table "hash_name" $ p5
  ( optional "id"
  , required "hash"
  , required "contract_metadata_id"
  , required "transaction_type"
  , required "data_string"
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
  ( optional "id"
  , required "src_hash"
  , required "src"
  )

contractsMetaDataTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  , Column PGBytea
  , Column PGBytea
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
  , Column PGBytea
  , Column PGBytea
  )
contractsMetaDataTable = Table "contracts_metadata" $ p8
  ( optional "id"
  , required "contract_id"
  , required "bin"
  , required "bin_runtime"
  , required "code_hash"
  , required "xcode_hash"
  , required "src_hash"
  , required "xabi"
  )

contractsInstanceTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  , Column PGBytea
  , Maybe (Column PGTimestamptz)
  , Column PGBytea
  )
  ( Column PGInt4
  , Column PGInt4
  , Column PGBytea
  , Column PGTimestamptz
  , Column PGBytea
  )
contractsInstanceTable = Table "contracts_instance" $ p5
  ( optional "id"
  , required "contract_metadata_id"
  , required "address"
  , optional "timestamp"
  , required "chainid"
  )

xabiFunctionsTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  , Column PGBool
  , Column PGText
  , Column (Nullable PGText)
  )
  ( Column PGInt4
  , Column PGInt4
  , Column PGBool
  , Column PGText
  , Column (Nullable PGText)
  )
xabiFunctionsTable = Table "xabi_functions" $ p5
  ( optional "id"
  , required "contract_metadata_id"
  , required "is_constructor"
  , required "name"
  , required "mutability"
  )

xabiTypesTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGText
  , Column (Nullable PGText)
  , Column PGBool
  , Column PGBool
  , Column (Nullable PGInt4)
  , Column (Nullable PGInt4)
  , Column (Nullable PGInt4)
  , Column (Nullable PGInt4)
  , Column (Nullable PGInt4)
  )
  ( Column PGInt4
  , Column PGText
  , Column (Nullable PGText)
  , Column PGBool
  , Column PGBool
  , Column (Nullable PGInt4)
  , Column (Nullable PGInt4)
  , Column (Nullable PGInt4)
  , Column (Nullable PGInt4)
  , Column (Nullable PGInt4)
  )
xabiTypesTable = Table "xabi_types" $ p10
  ( optional "id"
  , required "type"
  , required "typedef"
  , required "is_dynamic"
  , required "is_signed"
  , required "bytes"
  , required "length"
  , required "entry_type_id"
  , required "value_type_id"
  , required "key_type_id"
  )

xabiFunctionArgumentsTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  , Column PGInt4
  , Column PGText -- do all Solidity function arguments have names
  , Column PGInt4
  )
  ( Column PGInt4
  , Column PGInt4
  , Column PGInt4
  , Column PGText -- do all Solidity function arguments have names?
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
  , Column PGBool
  , Column PGBool
  , Column (Nullable PGText)
  )
  ( Column PGInt4
  , Column PGInt4
  , Column PGInt4
  , Column PGText
  , Column PGInt4
  , Column PGBool
  , Column PGBool
  , Column (Nullable PGText)
  )
xabiVariablesTable = Table "xabi_variables" $ p8
  ( optional "id"
  , required "contract_metadata_id"
  , required "type_id"
  , required "name"
  , required "at_bytes"
  , required "is_public"
  , required "is_constant"
  , required "value"
  )

xabiTypeDefsTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGText
  , Column PGInt4
  , Column PGText
  , Column PGInt4
  )
  ( Column PGInt4
  , Column PGText
  , Column PGInt4
  , Column PGText
  , Column PGInt4
  )
xabiTypeDefsTable = Table "xabi_type_defs" $ p5
  ( optional "id"
  , required "name"
  , required "contract_metadata_id"
  , required "type"
  , required "bytes"
  )

xabiEnumNamesTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGText
  , Column PGInt4
  , Column PGInt4
  )
  ( Column PGInt4
  , Column PGText
  , Column PGInt4
  , Column PGInt4
  )
xabiEnumNamesTable = Table "xabi_enum_names" $ p4
  ( optional "id"
  , required "name"
  , required "value"
  , required "type_def_id"
  )

xabiStructFieldsTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGText
  , Column PGInt4
  , Column PGInt4
  , Column PGInt4
  )
  ( Column PGInt4
  , Column PGText
  , Column PGInt4
  , Column PGInt4
  , Column PGInt4
  )
xabiStructFieldsTable = Table "xabi_struct_fields" $ p5
  ( optional "id"
  , required "name"
  , required "at_bytes"
  , required "type_def_id"
  , required "field_type_id"
  )

SolidVM is a solidity interpreter, to avoid the baggage of design decisions by
the solc team and improve VM performance. The basic structure is similar to EVM
transactions, in that contracts have code associated with them. Calling a
contract supplies arguments to a selected function, and the execution of that
function queries and modifies merkle patriciadbs.

Integration
-----------
The Merkle Patricia DBs are shared with the EVM (and future pluggable VMs),
meaning that the VM has only a single stateroot to manage. When


Storage
-------
Storage in solc is determined by a series of rules to calculate the offsets.
For a simple contract as a sequence of simple fields, the offsets increment for
each field. For a struct, multiple offsets are consumed determined by the width
of the struct. For arrays, the start is determined by the hash of the array
offset and then the element offsets are applied to that hash. For mapping, the
mapping offset is combined with the key and then hashed to find the offset of
the value.

The rules are more intuitive for solidvm fields, in that the offsets are no
longer numeric but rather strings determined by the names of fields and indices
into nested structures. While the storage rules for the EVM are determined by
byte size, this is only approximately true for SolidVM. Values that are not
structs/mappings/arrays are kept in a single slot, and while they are mostly
small in practice a single slot could correspond to a very long string.

The keys in the MerklePatricia tries are encodings of StoragePaths, where each
element of the StoragePath is either a Field, a MapIndex, or an ArrayIndex.
These elements navigate the hierarchy from the root of a contract to reach an
element, so that `sets[2]["ok"]` would be represented by [Field "sets",
ArrayIndex 2, MapIndex "ok"].  In order to make parsing unambiguous for paths,
`<` and `>` are used for index delimiters on MapIndexs, so the actual
representation of this location would be `.sets[2]<"ok">`.  To disambiguate
uint map keys from address map keys, the previous `a:` is used Additionally,
strings are escaped in order to avoid serializing "a\"b" and then parsing it as
"a" and leftovers.

The Field constructor is used flexibly, either to denote the name of a top
level contract field, a field of a struct, or the `length` field on an array.


Parsing
--------
Solidity contracts are parsed by Parsec custom parser. This is different from
the parser used by Bloch to determine metadata, to allow greater velocity here
without introducing regressions for EVM contracts. Like bloch, SolidVM expects
uploads to be done in a single file attached to inbound transactions. When
SolidVM has seen this file before and has its CodeCollection cached, it will
begin executing that. Otherwise, it will recompile the file and cached the
generated CodeCollection.


Execution
---------
The code is represented as a list of Xabi.Statements. Each Statement might
depend on a sublist of statements (e.g. an If statement) or expressions (e.g.
assignment).  `runStatements` is effectively a `mapM runStatement`, and so
`runStatement` might recursively call `runStatements`. Expressions are resolved
to a reference with `expToVar`, and if they need to be collapsed to a rvalue
then `getVar` will convert a Variable (that may be either an IORef or a pure
value) to a Value. When an lvalue is needed, `expToPath` can resolve an
expression to location in storage.  Note, however, that Values might still be
references: the SReference type points to a location in storage.

For language builtins, there are predefined routines that are executed. There
are also predefined routines to avoid more costly feature implementations.
Rather than use the actual inline assembly in blockapps-sol, `MloadAdd32`
simulates its effects and rejects all other inline assembly programs. Rather
than implementing writable references to characters inside of a string, we
simulate that solidity with `SHexDecodeAndTrim or `SAddressToAscii`.

Prefer to use the exceptions in SolidException rather than `error`. By default,
these exceptions will be caught at the end of a `runSM` block, with the
exception of `internalError`. To catch none of the exceptions, run with
`svmDev=true`.


Execution is currently gasless, but at some point gas should be implemented to
defend the node from a bad transaction.

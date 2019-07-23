SolidVM is a solidity interpreter, to avoid the baggage of design decisions by the solc team
and improve VM performance. The basic structure is similar to EVM transactions, in that
contracts have code associated with them. Calling a contract supplies arguments to a
selected function, and the execution of that function queries and modifies merkle patriciadbs.

Storage
-------
Storage in solc is determined by a series of rules to calculate the offsets. For a simple contract
as a sequence of simple fields, the offsets increment for each field. For a struct, multiple offsets
are consumed determined by the width of the struct. For arrays, the start is determined by the hash
of the array offset and then the element offsets are applied to that hash. For mapping, the
mapping offset is combined with the key and then hashed to find the offset of the value.

The rules are more intuitive for solidvm fields, in that the offsets are no longer numeric but
rather strings determined by the names of fields and indices into nested structures. While
the storage rules for the EVM are determined by byte size, this is only approximately true
for SolidVM. Values that are not structs/mappings/arrays are kept in a single slot, and while
they are mostly small in practice a single slot could correspond to a very long string.



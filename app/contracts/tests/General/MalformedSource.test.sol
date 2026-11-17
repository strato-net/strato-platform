// Source that cannot be compiled, and an import of a destroyed contract, fail
// the creation that carries them and nothing else.
interface IKill { function kill() external; }

contract Describe_MalformedSource {
    function fails(string name, string src) internal returns (bool) {
        try { create(name, src); } catch { return true; }
        return false;
    }

    function it_a_hex_literal_without_a_string_fails_to_compile() public {
        require(fails("A", "contract A { function f() public { bytes b = hex; } }"), "compiled");
    }

    function it_b_emit_without_arguments_for_a_parameterized_event_fails_to_compile() public {
        require(fails("A", "contract A { event E(uint x); function f() public { emit E(); } }"), "compiled");
    }

    function it_c_import_of_a_destroyed_contract_is_skipped() public {
        address k = create("K", "contract K { function kill() public { selfdestruct(msg.sender); } }");
        IKill(k).kill();
        require(!fails("A", "import <" + string(k) + ">; contract A { }"), "creation failed");
    }

    function it_d_runs_afterwards() public {
        require(true, "after");
    }
}

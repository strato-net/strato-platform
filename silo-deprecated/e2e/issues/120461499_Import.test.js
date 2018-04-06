const common = require('../lib/common');
const config = common.config;
const constants = common.constants;
const api = common.api;
const assert = common.assert;
const util = common.util;
const itShould = common.itShould;
const User = common.model.User
const Contract = common.model.Contract;
const Call = common.model.Call;
const Tx = common.model.Tx;
const BigNumber = common.BigNumber;

const importer = require('../lib/importer');

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

describe('120461499_Import', function() {
  this.timeout(config.timeout);

  it('should no import', function(done) {
    const filename = "./fixtures/import/regular/a.sol";
    return importer.getBlob(filename)
      .then(function(string) {
        console.log(string);
        done();
      })
      .catch(done);
  });

  it('should regular_import', function(done) {
    const filename = "./fixtures/import/regular/b.sol";
    return importer.getBlob(filename)
      .then(function(string) {
        console.log(string);
        done();
      })
      .catch(done);
  });

  it('should import_is_transitive', function(done) {
    const filename = "./fixtures/import/transitive/c.sol";
    return importer.getBlob(filename)
      .then(function(string) {
        console.log(string);
        done();
      })
      .catch(done);
  });

  it('should circular_import', function(done) {
    const filename = "./fixtures/import/circular/a.sol";
    return importer.getBlob(filename)
      .then(function(string) {
        console.log(string);
        done();
      })
      .catch(done);
  });

  it('should relative_import', function(done) {
    const filename = "./fixtures/import/relative/a.sol";
    return importer.getBlob(filename)
      .then(function(string) {
        console.log(string);
        done();
      })
      .catch(done);
  });
});


// --- Syntax and Semantics
// import "filename";
//import * as symbolName from "filename";
//import {symbol1 as alias, symbol2} from "filename";
//import "filename" as symbolName;
//Paths
// . as the current
// .. as the parent directory
// Path names that do not start with . are treated as absolute paths.

// --- nesting
// it should import 0 files
// it should import 1 file
// it should import multiple files
// it should import nested files. (A<-B, B<-C)
// it should import multiple nested files. (A<-B,C,D, B<-E,F, C<-G,H, D<-I,J)
// it should import multiple nested files with duplicate symbols. (A<-B,C B<-D,C)

/*
	This file is part of cpp-ethereum.
	cpp-ethereum is free software: you can redistribute it and/or modify
	it under the terms of the GNU General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	cpp-ethereum is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU General Public License for more details.
	You should have received a copy of the GNU General Public License
	along with cpp-ethereum.  If not, see <http://www.gnu.org/licenses/>.
*/
/**
 * @author Christian <c@ethdev.com>
 * @date 2015
 * Tests for high level features like import.
 */
/*
#include <string>
#include <boost/test/unit_test.hpp>
#include <libsolidity/interface/Exceptions.h>
#include <libsolidity/interface/CompilerStack.h>

using namespace std;

namespace dev
{
namespace solidity
{
namespace test
{

BOOST_AUTO_TEST_SUITE(SolidityImports)

BOOST_AUTO_TEST_CASE(smoke_test)
{
	CompilerStack c;
	c.addSource("a", "contract C {}");
	BOOST_CHECK(c.compile());
}

BOOST_AUTO_TEST_CASE(regular_import)
{
	CompilerStack c;
	c.addSource("a", "contract C {}");
	c.addSource("b", "import \"a\"; contract D is C {}");
	BOOST_CHECK(c.compile());
}

BOOST_AUTO_TEST_CASE(import_does_not_clutter_importee)
{
	CompilerStack c;
	c.addSource("a", "contract C { D d; }");
	c.addSource("b", "import \"a\"; contract D is C {}");
	BOOST_CHECK(!c.compile());
}

BOOST_AUTO_TEST_CASE(import_is_transitive)
{
	CompilerStack c;
	c.addSource("a", "contract C { }");
	c.addSource("b", "import \"a\";");
	c.addSource("c", "import \"b\"; contract D is C {}");
	BOOST_CHECK(c.compile());
}

BOOST_AUTO_TEST_CASE(circular_import)
{
	CompilerStack c;
	c.addSource("a", "import \"b\"; contract C { D d; }");
	c.addSource("b", "import \"a\"; contract D { C c; }");
	BOOST_CHECK(c.compile());
}

BOOST_AUTO_TEST_CASE(relative_import)
{
	CompilerStack c;
	c.addSource("a", "import \"./dir/b\"; contract A is B {}");
	c.addSource("dir/b", "contract B {}");
	c.addSource("dir/c", "import \"../a\"; contract C is A {}");
	BOOST_CHECK(c.compile());
}

BOOST_AUTO_TEST_CASE(relative_import_multiplex)
{
	CompilerStack c;
	c.addSource("a", "contract A {}");
	c.addSource("dir/a/b/c", "import \"../../.././a\"; contract B is A {}");
	BOOST_CHECK(c.compile());
}

BOOST_AUTO_TEST_CASE(simple_alias)
{
	CompilerStack c;
	c.addSource("a", "contract A {}");
	c.addSource("dir/a/b/c", "import \"../../.././a\" as x; contract B is x.A { function() { x.A r = x.A(20); } }");
	BOOST_CHECK(c.compile());
}

BOOST_AUTO_TEST_CASE(library_name_clash)
{
	CompilerStack c;
	c.addSource("a", "library A {}");
	c.addSource("b", "library A {}");
	BOOST_CHECK(!c.compile());
}

BOOST_AUTO_TEST_CASE(library_name_clash_with_contract)
{
	CompilerStack c;
	c.addSource("a", "contract A {}");
	c.addSource("b", "library A {}");
	BOOST_CHECK(c.compile());
}

BOOST_AUTO_TEST_CASE(complex_import)
{
	CompilerStack c;
	c.addSource("a", "contract A {} contract B {} contract C { struct S { uint a; } }");
	c.addSource("b", "import \"a\" as x; import {B as b, C as c, C} from \"a\"; "
				"contract D is b { function f(c.S var1, x.C.S var2, C.S var3) internal {} }");
	BOOST_CHECK(c.compile());
}

BOOST_AUTO_TEST_CASE(name_clash_in_import)
{
	CompilerStack c;
	c.addSource("a", "contract A {}");
	c.addSource("b", "import \"a\"; contract A {} ");
	BOOST_CHECK(!c.compile());
	c.addSource("b", "import \"a\" as A; contract A {} ");
	BOOST_CHECK(!c.compile());
	c.addSource("b", "import {A as b} from \"a\"; contract b {} ");
	BOOST_CHECK(!c.compile());
	c.addSource("b", "import {A} from \"a\"; contract A {} ");
	BOOST_CHECK(!c.compile());
	c.addSource("b", "import {A} from \"a\"; contract B {} ");
	BOOST_CHECK(c.compile());
}

BOOST_AUTO_TEST_CASE(remappings)
{
	CompilerStack c;
	c.setRemappings(vector<string>{"s=s_1.4.6", "t=Tee"});
	c.addSource("a", "import \"s/s.sol\"; contract A is S {}");
	c.addSource("b", "import \"t/tee.sol\"; contract A is Tee {} ");
	c.addSource("s_1.4.6/s.sol", "contract S {}");
	c.addSource("Tee/tee.sol", "contract Tee {}");
	BOOST_CHECK(c.compile());
}

BOOST_AUTO_TEST_CASE(context_dependent_remappings)
{
	CompilerStack c;
	c.setRemappings(vector<string>{"a:s=s_1.4.6", "b:s=s_1.4.7"});
	c.addSource("a/a.sol", "import \"s/s.sol\"; contract A is SSix {}");
	c.addSource("b/b.sol", "import \"s/s.sol\"; contract B is SSeven {}");
	c.addSource("s_1.4.6/s.sol", "contract SSix {} ");
	c.addSource("s_1.4.7/s.sol", "contract SSeven {} ");
	BOOST_CHECK(c.compile());
}

BOOST_AUTO_TEST_SUITE_END()

}
}
} // end namespaces
*/

.PHONY: test test-suite vm-tests multinode 

build:
	echo "building all tests"
	stack test --no-run-tests test-suite

vm-tests:
	echo "running vm tests"
	if [ -d "test-suite/tests" ]; then \
          echo ".. tests already exists"; \
        else \
          git clone https://github.com/ethereum/tests.git test-suite/tests; \
        fi
	docker cp test-suite/tests strato_strato_1:/var/lib/strato/tests
	docker cp test-suite/.stack-work/dist/x86_64-linux/Cabal-1.24.2.0/build/vm-tests/vm-tests strato_strato_1:/usr/bin
	docker exec strato_strato_1 bash -c "cd /var/lib/strato; vm-tests"

test-suite:
	echo "running integration tests"
	docker cp test-suite/.stack-work/dist/x86_64-linux/Cabal-1.24.2.0/build/test-suite/test-suite strato_strato_1:/usr/bin
	docker exec strato_strato_1 bash -c "cd /var/lib/strato; test-suite"

multinode:
	echo "testing multinode tests"
	if [ -d "multinode-test" ]; then \
	  echo "... multinode already checked out"; \
	else \
	  git clone https://github.com/blockapps/multinode-test -b kristoffer multinode-test; \
	fi
	cd multinode-test/ && npm install && ./node_modules/mocha/bin/mocha test/ --reporter mochawesome

solidity:
	echo "solidity-abi"
	stack test solidity-abi


test: build solidity test-suite vm-tests multinode

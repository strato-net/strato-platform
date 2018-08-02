BASILWORK=.basil-work
BASILWORK_ABS=$(shell pwd)/$(BASILWORK)
STACKWORK=$(BASILWORK)/stack
FAKEROOT=$(BASILWORK)/fakeroot
BLOCHOME=$(FAKEROOT)/usr/bin/bloc
BUILDER_HOME=$(BASILWORK_ABS)/builder_home
DEPLOYBASE_NAME=bloch-deploybase
LICENSE_DIR=$(FAKEROOT)/licenses
LICENSE_SOURCE_DIR=$(LICENSE_DIR)/sources
SLIPSTREAM=${FAKEROOT}/usr/bin/slipstream

STACK_RESOLVER=$(shell cat stack.yaml | grep "resolver:" | awk '{print $$2}')

SOLC_VERSION=0.4.24

all: build_docker clean

prebuild:
	mkdir -p $(BASILWORK)
	mkdir -p $(STACKWORK)
	mkdir -p $(FAKEROOT)/usr/bin
	mkdir -p $(BLOCHOME)
	mkdir -p $(BUILDER_HOME)
	mkdir -p $(LICENSE_SOURCE_DIR)
	mkdir -p /tmp/docker-dummy-bloc

build_solidity: prebuild
	./pull_solc.sh $(SOLC_VERSION) $(FAKEROOT)/usr/bin $(LICENSE_SOURCE_DIR)/solidity

build_buildbase: prebuild build_solidity
	cp -f Dockerfile.buildbase /tmp/docker-dummy-bloc
	cp -f $(FAKEROOT)/usr/bin/solc /tmp/docker-dummy-bloc
	docker build --build-arg STACK_RESOLVER=${STACK_RESOLVER} --tag=stack-bloc-buildbase:${STACK_RESOLVER} -f /tmp/docker-dummy-bloc/Dockerfile.buildbase /tmp/docker-dummy-bloc

build_haskell: prebuild build_buildbase
	stack setup
	stack install --local-bin-path=$(FAKEROOT)/usr/bin

build_deploybase: prebuild
	cp -f Dockerfile.deploybase /tmp/docker-dummy-bloc
	cp -fr licenses/* ${LICENSE_DIR}
	docker build --tag=$(DEPLOYBASE_NAME):latest -f /tmp/docker-dummy-bloc/Dockerfile.deploybase /tmp/docker-dummy-bloc
	rm -f /tmp/docker-dummy-bloc/Dockerfile.deploybase

build_docker: build_deploybase build_solidity build_haskell
	cp -f Dockerfile $(FAKEROOT)
	cp -f doit.sh $(BLOCHOME)
	cp -f $(FAKEROOT)/usr/bin/blockapps-strato-server $(BLOCHOME)
	cp -f $(FAKEROOT)/usr/bin/blockapps-bloc $(BLOCHOME)
	docker build -t $(BASIL_DOCKER_TAG) $(FAKEROOT)

clean:
	rm -rf $(BASILWORK)
	rm -rf /tmp/docker-dummy-bloc

BASILWORK=.basil-work
BASILWORK_ABS=$(shell pwd)/$(BASILWORK)
STACKWORK=$(BASILWORK)/stack
FAKEROOT=$(BASILWORK)/fakeroot
BLOCHOME=$(FAKEROOT)/usr/bin/bloc
BUILDER_HOME=$(BASILWORK_ABS)/builder_home
DEPLOYBASE_NAME=bloch-deploybase

STACK_RESOLVER=$(shell cat stack.yaml | grep "resolver:" | awk '{print $$2}')

SOLC_VERSION=0.4.24

all: build_docker

prebuild:
	mkdir -p $(BASILWORK)
	mkdir -p $(STACKWORK)
	mkdir -p $(FAKEROOT)/usr/bin
	mkdir -p $(BLOCHOME)
	mkdir -p $(BUILDER_HOME)
	mkdir -p /tmp/docker-dummy

build_solidity: prebuild
	./pull_solc.sh $(SOLC_VERSION) $(FAKEROOT)/usr/bin
	# make the pulled solc available in stack-bloc-buildbase container (e.g. solc is used for "stack test blockapps-bloc22-server")
	# this solc will have higher priority in container than the one mounted in stack.yaml docker section (`/root/.local/bin` is used prior to `/usr/local/bin` according to $PATH)
	mkdir -p .stack-work/docker/_home/.local/bin/ && cp .basil-work/fakeroot/usr/bin/solc .stack-work/docker/_home/.local/bin/

build_haskell: prebuild
	cp -f Dockerfile.buildbase /tmp/docker-dummy
	docker build --build-arg STACK_RESOLVER=${STACK_RESOLVER} --tag=stack-bloc-buildbase:${STACK_RESOLVER} -f /tmp/docker-dummy/Dockerfile.buildbase /tmp/docker-dummy
	stack setup
	stack install --local-bin-path=$(FAKEROOT)/usr/bin

build_deploybase: prebuild
	cp -f Dockerfile.deploybase /tmp/docker-dummy
	docker build --tag=$(DEPLOYBASE_NAME):latest -f /tmp/docker-dummy/Dockerfile.deploybase /tmp/docker-dummy
	rm -f /tmp/docker-dummy/Dockerfile.deploybase

build_docker: build_deploybase build_solidity build_haskell
	cp -f Dockerfile $(FAKEROOT)
	cp -f doit.sh $(BLOCHOME)
	cp -f $(FAKEROOT)/usr/bin/blockapps-strato-server $(BLOCHOME)
	cp -f $(FAKEROOT)/usr/bin/blockapps-bloc $(BLOCHOME)
	docker build -t $(BASIL_DOCKER_TAG) $(FAKEROOT)

clean:
	rm -rf $(BASILWORK)
	rm -rf /tmp/docker-dummy

BASILWORK=.basil-work
BASILWORK_ABS=$(shell pwd)/$(BASILWORK)
STACKWORK=$(BASILWORK)/stack
FAKEROOT=$(BASILWORK)/fakeroot
BUILDER_HOME=$(BASILWORK_ABS)/builder_home

STACK_RESOLVER=$(shell cat stack.yaml | grep "resolver:" | awk '{print $$2}')

all: build_docker clean

prebuild:
	mkdir -p $(BASILWORK)
	mkdir -p $(STACKWORK)
	mkdir -p $(FAKEROOT)/usr/bin
	mkdir -p $(BUILDER_HOME)
	mkdir -p /tmp/docker-dummy-vault-wrapper

build_buildbase: prebuild
	cp -f Dockerfile.buildbase /tmp/docker-dummy-vault-wrapper
	docker build --build-arg STACK_RESOLVER=${STACK_RESOLVER} --tag=stack-vault-wrapper-buildbase:${STACK_RESOLVER} -f /tmp/docker-dummy-vault-wrapper/Dockerfile.buildbase /tmp/docker-dummy-vault-wrapper

build_haskell: build_buildbase
	stack setup
	stack install --local-bin-path=$(FAKEROOT)/usr/bin

build_docker: build_haskell
	cp -f Dockerfile $(FAKEROOT)
	cp -f doit.sh $(FAKEROOT)
	docker build -t $(BASIL_DOCKER_TAG) $(FAKEROOT)

clean:
	rm -rf $(BASILWORK)
	rm -rf /tmp/docker-dummy-vault-wrapper

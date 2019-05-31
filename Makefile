REPO_URL ?= EMPTY
ifeq ($(REPO),local)
  REPO_URL=
endif
ifeq ($(REPO),private)
  REPO_URL=registry-aws.blockapps.net:5000/blockapps/
endif
ifeq ($(REPO),public)
  REPO_URL=registry-aws.blockapps.net:5000/blockapps-repo/
endif
ifeq ($(REPO_URL),EMPTY)
  $(error REPO not provided or unknown value. Please provide one of the types for REPO var: [local, private, public]. Or custom REPO_URL)
endif
$(info REPO_URL is "${REPO_URL}" (${REPO}))

STACK_RESOLVER=$(shell cat stack.yaml | grep "resolver:" | awk '{print $$2}')
TMPDIR=/tmp/$(shell whoami)/strato-docker-dummy
FAKEROOT=$(shell pwd)/.docker-work
BLOCDIR=${FAKEROOT}/bloc
STRATODIR=${FAKEROOT}/strato
VAULTDIR=${FAKEROOT}/vault-wrapper

ifndef VERSION
  ifeq ($(REPO),public)
    VERSION = `cat VERSION`
    $(info Using version tag from VERSION file)
  else
    VERSION = `cat VERSION`-`git rev-parse --short HEAD`
  endif
else
  $(info VERSION is "${VERSION}" (overriden with env var))
endif

$(info )

all: build_all docker-compose

build_all: bloc strato apex dappstore nginx postgrest prometheus smd vault-wrapper

.PHONY: bloc strato apex dappstore nginx postgrest prometheus smd vault-wrapper get_solcs build_buildbase build_common build_common_profiled

apex:
	@echo Now building apex...
	BASIL_DOCKER_TAG=${REPO_URL}apex:${VERSION} make --directory=apex/

dappstore:
	@echo Now building dappstore...
	BASIL_DOCKER_TAG=${REPO_URL}dappstore:${VERSION} make --directory=dapp-store/

nginx:
	@echo Now building nginx...
	BASIL_DOCKER_TAG=${REPO_URL}nginx:${VERSION} make --directory=nginx-packager/

postgrest:
	@echo Now building postgrest...
	BASIL_DOCKER_TAG=$(REPO_URL)postgrest:${VERSION} make --directory=postgrest-packager/

prometheus:
	@echo Now building prometheus...
	BASIL_DOCKER_TAG=$(REPO_URL)prometheus:${VERSION} make --directory=prometheus-packager/

smd:
	@echo building smd...
	BASIL_DOCKER_TAG=${REPO_URL}smd:${VERSION} make --directory=smd-ui/

get_solcs:
	mkdir -p ${TMPDIR} ${FAKEROOT}/usr/local/bin
	# One copy for the buildbase and one copy for the deploybase for tests and production respectively
	blockapps-haskell/pull_solc.sh 0.4.25 ${TMPDIR}/solc-0.4 ${TMPDIR}/license-solc-0.4
	blockapps-haskell/pull_solc.sh 0.5.2 ${TMPDIR}/solc-0.5 ${TMPDIR}/license-solc-0.5
	cp ${TMPDIR}/solc-0.4 ${FAKEROOT}/usr/local/bin
	cp ${TMPDIR}/solc-0.5 ${FAKEROOT}/usr/local/bin
	cp -fr ${TMPDIR}/license* ${FAKEROOT}
	ln -f ${TMPDIR}/solc-0.4 ${TMPDIR}/solc
	ln -f ${FAKEROOT}/usr/local/bin/solc-0.4 ${FAKEROOT}/usr/local/bin/solc

build_buildbase: get_solcs
	cp -f Dockerfile.buildbase ${TMPDIR}
	docker build --build-arg STACK_RESOLVER=${STACK_RESOLVER} --tag=strato-buildbase:${STACK_RESOLVER} -f ${TMPDIR}/Dockerfile.buildbase ${TMPDIR}

build_common: get_solcs build_buildbase
	@echo building haskell libraries and creating directories
	mkdir -p ${FAKEROOT}/bloc
	mkdir -p ${FAKEROOT}/strato
	mkdir -p ${FAKEROOT}/vault-wrapper
	stack build \
		--test --no-run-tests \
		--copy-bins --local-bin-path=${FAKEROOT}/usr/local/bin

build_common_profiled: get_solcs build_buildbase
	@echo building haskell libraries and creating directories
	mkdir -p ${FAKEROOT}/bloc
	mkdir -p ${FAKEROOT}/strato
	mkdir -p ${FAKEROOT}/vault-wrapper
	stack build \
		--profile --work-dir .stack-work-profile \
		--copy-bins --local-bin-path=${FAKEROOT}/usr/local/bin

bloc: build_common
	@echo Now building bloc...
	cp -fr blockapps-haskell/licenses ${BLOCDIR}
	cp blockapps-haskell/doit.sh ${BLOCDIR}
	docker build --target bloc --tag ${REPO_URL}bloc:${VERSION} --file Dockerfile.multi ${FAKEROOT}

strato: build_common
	@echo Now building core-strato...
	cp -fr core-strato/licenses ${STRATODIR}
	cp core-strato/doit.sh ${STRATODIR}
	docker build --target strato --tag ${REPO_URL}strato:${VERSION} --file Dockerfile.multi ${FAKEROOT}

vault-wrapper: build_common
	@echo Now building vault-wrapper...
	cp blockapps-haskell/vault-wrapper/doit.sh ${VAULTDIR}
	docker build --target vault-wrapper --tag ${REPO_URL}vault-wrapper:${VERSION} --file Dockerfile.multi ${FAKEROOT}

docker-compose:
	@echo Now generating docker-compose yml files...
	@echo Creating the image-push-ready docker-compose.push.yml...
	sed -e 's|<REPO_URL>|'"${REPO_URL}"'|g' -e 's|<VERSION>|'"${VERSION}"'|g' docker-compose.tpl.yml > docker-compose.push.yml
	@echo Creating the final docker-compose.yml...
	awk '/build: ./{getline} 1' docker-compose.push.yml > docker-compose.yml


test:
	@echo ${VERSION}

docker-clean:
	rm -rf ${FAKEROOT}

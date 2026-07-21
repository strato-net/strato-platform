REPO_URL ?= 
ifeq ($(REPO),dev)
  REPO_URL=registry-aws.blockapps.net:5000/blockapps/
endif
ifeq ($(REPO),release)
  REPO_URL=registry-aws.blockapps.net:5000/blockapps-repo/
endif
$(info REPO_URL is "${REPO_URL}" (REPO: "${REPO}"))
REPO_AWS_ECR_URL=406773134706.dkr.ecr.us-east-1.amazonaws.com/strato/
$(info REPO_AWS_ECR_URL is "${REPO_AWS_ECR_URL}")

STACK_RESOLVER=$(shell cat strato/stack.yaml | grep "resolver:" | awk '{print $$2}')
FAKEROOT=$(shell pwd)/.docker-work
HIGHWAYDIR=${FAKEROOT}/highway
STRATODIR=${FAKEROOT}/strato
VAULTDIR=${FAKEROOT}/vault-wrapper

# NIX support - add --nix flag to stack commands when NIX=true
ifeq ($(NIX),true)
  NIX_FLAG=--nix
else
  NIX_FLAG=
endif

ifndef VERSION
  # REPO=release: use VERSION file directly (e.g., "16.7")
  # Otherwise (dev/CI builds): append short commit hash for per-build uniqueness (e.g., "16.7-abc1234")
  ifeq ($(REPO),release)
    VERSION := $(shell cat VERSION)
  else
	# INTENT: deterministic version for image tagging
	#
	# AVOID `git describe --tags --abbrev=0`:
	# - branch/merge dependent
	# - may return outdated/pre-release tags (e.g. `16.7-rc1` < `16.7`) or custom dev tags
	#
	# APPROACH:
	# - VERSION file = source of truth
	# - short commit SHA for uniqueness
	#
    VERSION := $(shell cat VERSION)-$(shell git rev-parse --short=7 HEAD)
  endif
else
  $(info VERSION is "$(VERSION)" (overriden with env var))
endif

$(info )

.DEFAULT_GOAL := all

# Compute content hash for a directory (truncated to 12 chars)
# Usage: $(call dir_hash,directory_path)
dir_hash = $(shell git ls-files $(1) 2>/dev/null | LC_ALL=C sort | xargs sha256sum 2>/dev/null | sha256sum | cut -c1-12)

# Image content hashes - used for docker tags
HASH_STRATO := $(call dir_hash,strato)
HASH_POSTGREST := $(call dir_hash,postgrest-packager)
HASH_NGINX := $(call dir_hash,nginx-packager)
HASH_APEX := $(call dir_hash,apex)
HASH_MERCATA_BACKEND := $(call dir_hash,mercata/backend)
HASH_MERCATA_UI := $(call dir_hash,mercata/ui)
HASH_PROMETHEUS := $(call dir_hash,prometheus-packager)
HASH_SMD := $(call dir_hash,smd-ui)
HASH_BRIDGE := $(call dir_hash,mercata/services/bridge)
HASH_BRIDGE_NGINX := $(call dir_hash,mercata/services/bridge/nginx)
HASH_LOCAL_AUTH := $(call dir_hash,local-auth)

# Check if image exists in Docker — rebuild if missing (hash in tag handles source changes)
# Usage: $(call image_missing,image_name_with_tag)
image_missing = ! docker image inspect $(1) >/dev/null 2>&1

# Generate BUILD_METADATA file with version and all hashes for Haskell to read
# This file is the single source of truth for build metadata
.PHONY: generate-version-file
generate-version-file:
	@echo "VERSION=$(VERSION)" > BUILD_METADATA
	@echo "HASH_STRATO=$(HASH_STRATO)" >> BUILD_METADATA
	@echo "HASH_MERCATA_BACKEND=$(HASH_MERCATA_BACKEND)" >> BUILD_METADATA
	@echo "HASH_MERCATA_UI=$(HASH_MERCATA_UI)" >> BUILD_METADATA
	@echo "HASH_SMD=$(HASH_SMD)" >> BUILD_METADATA
	@echo "HASH_APEX=$(HASH_APEX)" >> BUILD_METADATA
	@echo "HASH_POSTGREST=$(HASH_POSTGREST)" >> BUILD_METADATA
	@echo "HASH_NGINX=$(HASH_NGINX)" >> BUILD_METADATA
	@echo "HASH_PROMETHEUS=$(HASH_PROMETHEUS)" >> BUILD_METADATA
	@echo "HASH_LOCAL_AUTH=$(HASH_LOCAL_AUTH)" >> BUILD_METADATA
	@echo "Generated BUILD_METADATA file"

# Sed substitutions for docker-compose templates
HASH_SUBS = -e 's|<HASH_STRATO>|$(HASH_STRATO)|g' \
            -e 's|<HASH_POSTGREST>|$(HASH_POSTGREST)|g' \
            -e 's|<HASH_NGINX>|$(HASH_NGINX)|g' \
            -e 's|<HASH_APEX>|$(HASH_APEX)|g' \
            -e 's|<HASH_MERCATA_BACKEND>|$(HASH_MERCATA_BACKEND)|g' \
            -e 's|<HASH_MERCATA_UI>|$(HASH_MERCATA_UI)|g' \
            -e 's|<HASH_PROMETHEUS>|$(HASH_PROMETHEUS)|g' \
            -e 's|<HASH_SMD>|$(HASH_SMD)|g' \
            -e 's|<HASH_BRIDGE>|$(HASH_BRIDGE)|g' \
            -e 's|<HASH_BRIDGE_NGINX>|$(HASH_BRIDGE_NGINX)|g'

.PHONY: postgrest nginx apex mercata-backend mercata-ui prometheus smd bridge bridge-nginx local-auth

postgrest:
	@if $(call image_missing,$(REPO_URL)postgrest:$(VERSION)-$(HASH_POSTGREST)); then \
		echo "Building postgrest ($(VERSION)-$(HASH_POSTGREST))..."; \
		BASIL_DOCKER_TAG=$(REPO_URL)postgrest:$(VERSION)-$(HASH_POSTGREST) ECR_DOCKER_TAG=$(REPO_AWS_ECR_URL)postgrest:$(VERSION)-$(HASH_POSTGREST) $(MAKE) --directory=postgrest-packager/; \
	else \
		echo "postgrest up to date"; \
	fi

nginx:
	@if $(call image_missing,$(REPO_URL)nginx:$(VERSION)-$(HASH_NGINX)); then \
		echo "Building nginx ($(VERSION)-$(HASH_NGINX))..."; \
		BASIL_DOCKER_TAG=$(REPO_URL)nginx:$(VERSION)-$(HASH_NGINX) ECR_DOCKER_TAG=$(REPO_AWS_ECR_URL)nginx:$(VERSION)-$(HASH_NGINX) $(MAKE) --directory=nginx-packager/; \
	else \
		echo "nginx up to date"; \
	fi

apex:
	@if $(call image_missing,$(REPO_URL)apex:$(VERSION)-$(HASH_APEX)); then \
		echo "Building apex ($(VERSION)-$(HASH_APEX))..."; \
		BASIL_DOCKER_TAG=$(REPO_URL)apex:$(VERSION)-$(HASH_APEX) ECR_DOCKER_TAG=$(REPO_AWS_ECR_URL)apex:$(VERSION)-$(HASH_APEX) STRATO_VERSION=$(VERSION) $(MAKE) --directory=apex/; \
	else \
		echo "apex up to date"; \
	fi

mercata-backend:
	@if $(call image_missing,$(REPO_URL)mercata-backend:$(VERSION)-$(HASH_MERCATA_BACKEND)); then \
		echo "Building mercata-backend ($(VERSION)-$(HASH_MERCATA_BACKEND))..."; \
		docker build -t $(REPO_URL)mercata-backend:$(VERSION)-$(HASH_MERCATA_BACKEND) -f ./mercata/backend/Dockerfile ./mercata && \
		docker tag $(REPO_URL)mercata-backend:$(VERSION)-$(HASH_MERCATA_BACKEND) $(REPO_AWS_ECR_URL)mercata-backend:$(VERSION)-$(HASH_MERCATA_BACKEND); \
	else \
		echo "mercata-backend up to date"; \
	fi

mercata-ui:
	@if $(call image_missing,$(REPO_URL)mercata-ui:$(VERSION)-$(HASH_MERCATA_UI)); then \
		echo "Building mercata-ui ($(VERSION)-$(HASH_MERCATA_UI))..."; \
		docker build -t $(REPO_URL)mercata-ui:$(VERSION)-$(HASH_MERCATA_UI) -f ./mercata/ui/Dockerfile ./mercata && \
		docker tag $(REPO_URL)mercata-ui:$(VERSION)-$(HASH_MERCATA_UI) $(REPO_AWS_ECR_URL)mercata-ui:$(VERSION)-$(HASH_MERCATA_UI); \
	else \
		echo "mercata-ui up to date"; \
	fi

prometheus:
	@if $(call image_missing,$(REPO_URL)prometheus:$(VERSION)-$(HASH_PROMETHEUS)); then \
		echo "Building prometheus ($(VERSION)-$(HASH_PROMETHEUS))..."; \
		BASIL_DOCKER_TAG=$(REPO_URL)prometheus:$(VERSION)-$(HASH_PROMETHEUS) ECR_DOCKER_TAG=$(REPO_AWS_ECR_URL)prometheus:$(VERSION)-$(HASH_PROMETHEUS) $(MAKE) --directory=prometheus-packager/; \
	else \
		echo "prometheus up to date"; \
	fi

smd:
	@if $(call image_missing,$(REPO_URL)smd:$(VERSION)-$(HASH_SMD)); then \
		echo "Building smd ($(VERSION)-$(HASH_SMD))..."; \
		BASIL_DOCKER_TAG=$(REPO_URL)smd:$(VERSION)-$(HASH_SMD) ECR_DOCKER_TAG=$(REPO_AWS_ECR_URL)smd:$(VERSION)-$(HASH_SMD) STRATO_VERSION=$(VERSION) $(MAKE) --directory=smd-ui/; \
	else \
		echo "smd up to date"; \
	fi

bridge:
	@if $(call image_missing,$(REPO_URL)bridge:$(VERSION)-$(HASH_BRIDGE)); then \
		echo "Building bridge ($(VERSION)-$(HASH_BRIDGE))..."; \
		docker build -t $(REPO_URL)bridge:$(VERSION)-$(HASH_BRIDGE) ./mercata/services/bridge && \
		docker tag $(REPO_URL)bridge:$(VERSION)-$(HASH_BRIDGE) $(REPO_AWS_ECR_URL)bridge:$(VERSION)-$(HASH_BRIDGE); \
	else \
		echo "bridge up to date"; \
	fi

bridge-nginx:
	@if $(call image_missing,$(REPO_URL)bridge-nginx:$(VERSION)-$(HASH_BRIDGE_NGINX)); then \
		echo "Building bridge-nginx ($(VERSION)-$(HASH_BRIDGE_NGINX))..."; \
		docker build --add-host=openresty.org:3.125.51.27 -t $(REPO_URL)bridge-nginx:$(VERSION)-$(HASH_BRIDGE_NGINX) ./mercata/services/bridge/nginx && \
		docker tag $(REPO_URL)bridge-nginx:$(VERSION)-$(HASH_BRIDGE_NGINX) $(REPO_AWS_ECR_URL)bridge-nginx:$(VERSION)-$(HASH_BRIDGE_NGINX); \
	else \
		echo "bridge-nginx up to date"; \
	fi

all: local

local: build_common apex nginx postgrest prometheus smd mercata-backend mercata-ui bridge bridge-nginx oracle local-auth

docker: build_common_docker strato_docker apex highway highway-nginx nginx postgrest prometheus smd vault-wrapper vault-nginx mercata-backend mercata-ui bridge bridge-nginx oracle docker-compose

all_develop: build_develop docker-compose

build_develop: develop apex highway highway-nginx nginx postgrest prometheus smd vault-wrapper vault-nginx mercata-backend mercata-ui bridge bridge-nginx oracle

.PHONY: all_develop build_buildbase build_common build_common_docker build_common_profiled build_develop docker docker-compose highway highway-nginx local oracle strato strato_docker vault-nginx vault-wrapper vault-wrapper_docker migrate-key change-vault-password install-completions install-bash-completions install-zsh-completions apex-force nginx-force postgrest-force prometheus-force smd-force mercata-backend-force mercata-ui-force bridge-force bridge-nginx-force app

app: mercata-backend mercata-ui
	@echo ""
	@echo "Both app images built. To patch a running node:"
	@echo "  strato-patch-app <node-dir> $(REPO_URL)mercata-backend:$(VERSION)-$(HASH_MERCATA_BACKEND) $(REPO_URL)mercata-ui:$(VERSION)-$(HASH_MERCATA_UI)"

# Force rebuild targets (unconditional)
apex-force:
	@echo Now building apex...
	BASIL_DOCKER_TAG=${REPO_URL}apex:${VERSION}-${HASH_APEX} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}apex:${VERSION}-${HASH_APEX} STRATO_VERSION=${VERSION}-${HASH_APEX} make --directory=apex/

nginx-force:
	@echo Now building nginx...
	BASIL_DOCKER_TAG=${REPO_URL}nginx:${VERSION}-${HASH_NGINX} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}nginx:${VERSION}-${HASH_NGINX} make --directory=nginx-packager/

postgrest-force:
	@echo Now building postgrest...
	BASIL_DOCKER_TAG=$(REPO_URL)postgrest:${VERSION}-${HASH_POSTGREST} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}postgrest:${VERSION}-${HASH_POSTGREST} make --directory=postgrest-packager/

prometheus-force:
	@echo Now building prometheus...
	BASIL_DOCKER_TAG=$(REPO_URL)prometheus:${VERSION}-${HASH_PROMETHEUS} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}prometheus:${VERSION}-${HASH_PROMETHEUS} make --directory=prometheus-packager/

smd-force:
	@echo building smd...
	BASIL_DOCKER_TAG=${REPO_URL}smd:${VERSION}-${HASH_SMD} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}smd:${VERSION}-${HASH_SMD} STRATO_VERSION=${VERSION}-${HASH_SMD} make --directory=smd-ui/

mercata-backend-force:
	@echo Now building mercata-backend...
	docker build -t ${REPO_URL}mercata-backend:${VERSION}-${HASH_MERCATA_BACKEND} -f ./mercata/backend/Dockerfile ./mercata
	docker tag ${REPO_URL}mercata-backend:${VERSION}-${HASH_MERCATA_BACKEND} ${REPO_AWS_ECR_URL}mercata-backend:${VERSION}-${HASH_MERCATA_BACKEND}

mercata-ui-force:
	@echo Now building mercata-ui...
	docker build -t ${REPO_URL}mercata-ui:${VERSION}-${HASH_MERCATA_UI} -f ./mercata/ui/Dockerfile ./mercata
	docker tag ${REPO_URL}mercata-ui:${VERSION}-${HASH_MERCATA_UI} ${REPO_AWS_ECR_URL}mercata-ui:${VERSION}-${HASH_MERCATA_UI}

bridge-force:
	@echo Now building bridge...
	docker build -t ${REPO_URL}bridge:${VERSION}-${HASH_BRIDGE} ./mercata/services/bridge
	docker tag ${REPO_URL}bridge:${VERSION}-${HASH_BRIDGE} ${REPO_AWS_ECR_URL}bridge:${VERSION}-${HASH_BRIDGE}

bridge-nginx-force:
	@echo Now building bridge-nginx...
	docker build --add-host=openresty.org:3.125.51.27 -t ${REPO_URL}bridge-nginx:${VERSION}-${HASH_BRIDGE_NGINX} ./mercata/services/bridge/nginx
	docker tag ${REPO_URL}bridge-nginx:${VERSION}-${HASH_BRIDGE_NGINX} ${REPO_AWS_ECR_URL}bridge-nginx:${VERSION}-${HASH_BRIDGE_NGINX}

local-auth:
	@if $(call image_missing,local-auth:$(VERSION)-$(HASH_LOCAL_AUTH)); then \
		echo "Building local-auth ($(VERSION)-$(HASH_LOCAL_AUTH))..."; \
		docker build -t local-auth:$(VERSION)-$(HASH_LOCAL_AUTH) ./local-auth; \
	else \
		echo "local-auth up to date"; \
	fi

oracle:
	@echo Now building oracle... 
	# TODO: Dockerize
	@echo TODO: NO DOCKERFILE TO BUILD YET...
	#docker build -t ${REPO_URL}oracle:${VERSION} ./mercata/services/oracle
	#docker tag ${REPO_URL}oracle:${VERSION} ${REPO_AWS_ECR_URL}oracle:${VERSION}
	# TODO: #dcpush - replace with proper docker compose push flow
	#echo "${REPO_URL}oracle:${VERSION}" > oracle_image_tag
	#echo "${REPO_AWS_ECR_URL}oracle:${VERSION}" > oracle_image_tag_ecr

build_formatter:
	@echo building code formatter...
	docker build --build-arg STACK_RESOLVER=${STACK_RESOLVER} --tag=strato-formatter:${STACK_RESOLVER} - < Dockerfile.formatter

build_common: generate-version-file
	@echo building haskell libraries and creating directories
	mkdir -p ${HIGHWAYDIR}
	mkdir -p ${STRATODIR}
	mkdir -p ${VAULTDIR}
	cd strato && stack install ${NIX_FLAG}
	@echo installing strato bash scripts to ~/.local/bin
	@mkdir -p $(HOME)/.local/bin
	@install -m 755 bin/strato-login $(HOME)/.local/bin/
	@install -m 755 bin/strato-up $(HOME)/.local/bin/
	@install -m 755 bin/strato-down $(HOME)/.local/bin/
	@install -m 755 bin/strato-ps $(HOME)/.local/bin/
	@install -m 755 bin/strato-patch-app $(HOME)/.local/bin/
	@install -m 755 bin/strato-user-add $(HOME)/.local/bin/
	@install -m 755 bin/strato-snapshot $(HOME)/.local/bin/
	@install -m 755 bin/strato-logrotate $(HOME)/.local/bin/
	@mkdir -p $(HOME)/.local/share/strato
	@install -m 644 strato/tools/airlock/data/english.txt $(HOME)/.local/share/strato/bip39-english.txt
	@case ":$$PATH:" in \
	  *":$(HOME)/.local/bin:"*) ;; \
	  *) \
	    echo ""; \
	    echo "  NOTE: $(HOME)/.local/bin is not on your PATH in this shell."; \
	    echo "  The strato tools were installed there, but this shell won't find them yet."; \
	    echo "  To use them now, run:"; \
	    echo ""; \
	    echo "      source ~/.profile      # or open a new terminal"; \
	    echo ""; \
	    echo "  (New login shells will pick it up automatically.)"; \
	    echo "" ;; \
	esac

build_common_docker: generate-version-file
	@echo building haskell libraries and creating directories in docker
	mkdir -p ${HIGHWAYDIR}
	mkdir -p ${STRATODIR}
	mkdir -p ${VAULTDIR}
	cd strato && stack build ${NIX_FLAG} \
		--copy-bins --local-bin-path=${FAKEROOT}/usr/local/bin

build_common_with_tests: generate-version-file
	@echo building haskell libraries and creating directories
	mkdir -p ${HIGHWAYDIR}
	mkdir -p ${STRATODIR}
	mkdir -p ${VAULTDIR}
	cd strato && stack install ${NIX_FLAG} \
	  --test --no-run-tests

build_common_profiled: generate-version-file
	@echo building haskell libraries and creating directories (profiled)
	mkdir -p ${HIGHWAYDIR}
	mkdir -p ${STRATODIR}
	mkdir -p ${VAULTDIR}
	cd strato && stack build ${NIX_FLAG} \
		--profile --work-dir .stack-work-profile \
		--copy-bins --local-bin-path=${FAKEROOT}/usr/local/bin

build_common_fast: generate-version-file
	@echo building haskell libraries and creating directories (fast)
	mkdir -p ${STRATODIR}
	mkdir -p ${VAULTDIR}
	cd strato && stack build ${NIX_FLAG} \
		--fast --no-run-tests \
		--copy-bins --local-bin-path=${FAKEROOT}/usr/local/bin

pretty: build_formatter
	@echo formatting STRATO Haskell code...
	docker run --rm -v .:/strato-platform strato-formatter:${STACK_RESOLVER} ormolu --mode inplace `git ls-files '*.hs'`

gen-hie: build_formatter develop
	@echo generating hie.yaml file...
	docker run --rm -v .:/strato-platform strato-formatter:${STACK_RESOLVER} `cd strato && gen-hie > hie.yaml`

hoogle_generate:
	@echo generating STRATO documentation...
	cd strato && \
		stack haddock --haddock-internal && \
		stack hoogle generate -- --local

hoogle_serve:
	@echo serving the pregenerated STRATO documentation...
	cd strato && \
		stack hoogle -- server --local

hoogle: hoogle_generate hoogle_serve

highway: build_common_docker
	@echo Now building highway...
	cp strato/highway/doit.sh ${HIGHWAYDIR}
	docker build --target highway --tag ${REPO_URL}highway:${VERSION} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}highway:${VERSION} ${REPO_AWS_ECR_URL}highway:${VERSION}

highway-nginx:
	@echo Now building highway-nginx...
	BASIL_DOCKER_TAG=${REPO_URL}highway-nginx:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}highway-nginx:${VERSION} make --directory=highway-nginx/

strato: build_common
	@echo Now building core-strato...
	cp -fr strato/extraFiles/* ${STRATODIR}
	mkdir -p ${FAKEROOT}/usr/local/bin && install -m 755 bin/strato-logrotate ${FAKEROOT}/usr/local/bin/
	docker build --target strato --tag ${REPO_URL}strato:${VERSION}-${HASH_STRATO} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}strato:${VERSION}-${HASH_STRATO} ${REPO_AWS_ECR_URL}strato:${VERSION}-${HASH_STRATO}

strato_docker: build_common_docker
	@echo Now building core-strato for docker...
	cp -fr strato/extraFiles/* ${STRATODIR}
	mkdir -p ${FAKEROOT}/usr/local/bin && install -m 755 bin/strato-logrotate ${FAKEROOT}/usr/local/bin/
	docker build --target strato --tag ${REPO_URL}strato:${VERSION}-${HASH_STRATO} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}strato:${VERSION}-${HASH_STRATO} ${REPO_AWS_ECR_URL}strato:${VERSION}-${HASH_STRATO}

develop: build_common_fast
	@echo Now building core-strato using --fast...
	cp -fr strato/extraFiles/* ${STRATODIR}
	mkdir -p ${FAKEROOT}/usr/local/bin && install -m 755 bin/strato-logrotate ${FAKEROOT}/usr/local/bin/
	docker build --target strato --tag ${REPO_URL}strato:${VERSION}-${HASH_STRATO} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}strato:${VERSION}-${HASH_STRATO} ${REPO_AWS_ECR_URL}strato:${VERSION}-${HASH_STRATO}

profile: build_common_profiled
	@echo Now building core-strato using --profile...
	cp -fr strato/extraFiles/* ${STRATODIR}
	mkdir -p ${FAKEROOT}/usr/local/bin && install -m 755 bin/strato-logrotate ${FAKEROOT}/usr/local/bin/
	docker build --target strato --tag ${REPO_URL}strato:${VERSION}-${HASH_STRATO} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}strato:${VERSION}-${HASH_STRATO} ${REPO_AWS_ECR_URL}strato:${VERSION}-${HASH_STRATO}

vault-wrapper: build_common_docker
	@echo Now building vault-wrapper...
	cp strato/vault/doit.sh ${VAULTDIR}
	docker build --target vault-wrapper --tag ${REPO_URL}vault-wrapper:${VERSION} --file Dockerfile.multi ${FAKEROOT}
	docker tag ${REPO_URL}vault-wrapper:${VERSION} ${REPO_AWS_ECR_URL}vault-wrapper:${VERSION}

# Builds the migrate-key admin tool on the host and installs it to ~/.local/bin.
# See strato/vault/vault-runner/README.md ("Migrating a single key between Vaults")
# for the full operator workflow (docker cp into the vault-wrapper container, etc).
migrate-key:
	@echo Now building migrate-key...
	cd strato && stack ${NIX_FLAG} build blockapps-vault-wrapper-server:exe:migrate-key
	cd strato && stack ${NIX_FLAG} --local-bin-path ${HOME}/.local/bin install blockapps-vault-wrapper-server:exe:migrate-key
	@echo
	@echo "Installed: ${HOME}/.local/bin/migrate-key"
	@echo "Next steps: see strato/vault/vault-runner/README.md - 'Migrating a single key between Vaults'"

# Builds the change-vault-password admin tool on the host and installs it to ~/.local/bin.
# See strato/vault/vault-runner/README.md ("Changing the existing Vault password")
# for the full operator workflow (docker cp into the vault-wrapper container, etc).
change-vault-password:
	@echo Now building change-vault-password...
	cd strato && stack ${NIX_FLAG} build blockapps-vault-wrapper-server:exe:change-vault-password
	cd strato && stack ${NIX_FLAG} --local-bin-path ${HOME}/.local/bin install blockapps-vault-wrapper-server:exe:change-vault-password
	@echo
	@echo "Installed: ${HOME}/.local/bin/change-vault-password"
	@echo "Next steps: see strato/vault/vault-runner/README.md - 'Changing the existing Vault password'"

vault-nginx:
	@echo Now building vault-nginx...
	BASIL_DOCKER_TAG=${REPO_URL}vault-nginx:${VERSION} ECR_DOCKER_TAG=${REPO_AWS_ECR_URL}vault-nginx:${VERSION} make --directory=vault-nginx/

docker-compose:
	@echo Generating vault, highway, bridge compose files...
	sed -e 's|<REPO_URL>|$(REPO_URL)|g' -e 's|<VERSION>|$(VERSION)|g' docker-compose.vault.tpl.yml > docker-compose.vault.push.yml
	sed -e 's|<REPO_URL>|$(REPO_AWS_ECR_URL)|g' -e 's|<VERSION>|$(VERSION)|g' docker-compose.vault.tpl.yml > docker-compose.vault.push.ecr.yml
	sed -e 's|<REPO_URL>|$(REPO_URL)|g' -e 's|<VERSION>|$(VERSION)|g' docker-compose.highway.tpl.yml > docker-compose.highway.push.yml
	sed -e 's|<REPO_URL>|$(REPO_AWS_ECR_URL)|g' -e 's|<VERSION>|$(VERSION)|g' docker-compose.highway.tpl.yml > docker-compose.highway.push.ecr.yml
	sed -e 's|<REPO_URL>|$(REPO_URL)|g' -e 's|<VERSION>|$(VERSION)|g' $(HASH_SUBS) docker-compose.bridge.tpl.yml > docker-compose.bridge.push.yml
	sed -e 's|<REPO_URL>|$(REPO_AWS_ECR_URL)|g' -e 's|<VERSION>|$(VERSION)|g' $(HASH_SUBS) docker-compose.bridge.tpl.yml > docker-compose.bridge.push.ecr.yml

	awk '/build: ./{getline} 1' docker-compose.vault.push.yml > docker-compose.vault.yml
	awk '/build: ./{getline} 1' docker-compose.vault.push.ecr.yml > docker-compose.vault.ecr.yml
	awk '/build: ./{getline} 1' docker-compose.highway.push.yml > docker-compose.highway.yml
	awk '/build: ./{getline} 1' docker-compose.highway.push.ecr.yml > docker-compose.highway.ecr.yml
	awk '/build: ./{getline} 1' docker-compose.bridge.push.yml > docker-compose.bridge.yml
	awk '/build: ./{getline} 1' docker-compose.bridge.push.ecr.yml > docker-compose.bridge.ecr.yml

docker-build:
	cp -fr strato/extraFiles/* ${STRATODIR}
	mkdir -p ${FAKEROOT}/usr/local/bin && install -m 755 bin/strato-logrotate ${FAKEROOT}/usr/local/bin/
	docker build --target strato --tag ${REPO_URL}strato:${VERSION}-${HASH_STRATO} --file Dockerfile.multi ${FAKEROOT}

test:
	@echo ${VERSION}

docker-clean:
	rm -rf ${FAKEROOT}

# Shell completion installation - detects OS and shell, installs appropriate completions
UNAME_S := $(shell uname -s)
USER_SHELL := $(shell basename $$SHELL)

ifeq ($(UNAME_S),Darwin)
    BASH_COMPLETION_DIR := $(shell brew --prefix 2>/dev/null)/etc/bash_completion.d
    ifeq ($(BASH_COMPLETION_DIR),/etc/bash_completion.d)
        BASH_COMPLETION_DIR := $(HOME)/.local/share/bash-completion/completions
    endif
else
    BASH_COMPLETION_DIR := $(HOME)/.local/share/bash-completion/completions
endif
ZSH_COMPLETION_DIR := $(HOME)/.zsh/completions

install-completions:
ifeq ($(USER_SHELL),zsh)
	@$(MAKE) install-zsh-completions
else
	@$(MAKE) install-bash-completions
endif

install-bash-completions:
	@mkdir -p $(BASH_COMPLETION_DIR)
	@stack exec -- airlock --bash-completion-script airlock > $(BASH_COMPLETION_DIR)/airlock
	@stack exec -- baby-jubjub-cli --bash-completion-script baby-jubjub-cli > $(BASH_COMPLETION_DIR)/baby-jubjub-cli
	@echo '_strato_barometer() { COMPREPLY=($$(CMDARGS_COMPLETE=$$((COMP_CWORD-1)) strato-barometer "$${COMP_WORDS[@]:1}" 2>/dev/null | sed "s/^VALUE //")); }; complete -F _strato_barometer strato-barometer' > $(BASH_COMPLETION_DIR)/strato-barometer
	@echo "Bash completions installed to $(BASH_COMPLETION_DIR)"

install-zsh-completions:
	@mkdir -p $(ZSH_COMPLETION_DIR)
	@stack exec -- airlock --zsh-completion-script airlock > $(ZSH_COMPLETION_DIR)/_airlock
	@stack exec -- baby-jubjub-cli --zsh-completion-script baby-jubjub-cli > $(ZSH_COMPLETION_DIR)/_baby-jubjub-cli
	@echo '#compdef strato-barometer' > $(ZSH_COMPLETION_DIR)/_strato-barometer
	@echo '_strato_barometer() { local completions; completions=($${(f)"$$(CMDARGS_COMPLETE=$$((CURRENT-1)) strato-barometer "$${words[@]:1}" 2>/dev/null | sed "s/^VALUE //")"}); _describe "command" completions; }' >> $(ZSH_COMPLETION_DIR)/_strato-barometer
	@echo '_strato_barometer "$$@"' >> $(ZSH_COMPLETION_DIR)/_strato-barometer
	@echo "Zsh completions installed to $(ZSH_COMPLETION_DIR)"
	@echo "Add 'fpath=(~/.zsh/completions \$$fpath)' to ~/.zshrc if not already present"

# Uninstall strato CLI tools
.PHONY: uninstall

uninstall:
	@echo "Removing strato tools from ~/.local/bin..."
	@rm -f $(HOME)/.local/bin/strato-login
	@rm -f $(HOME)/.local/bin/strato-up
	@rm -f $(HOME)/.local/bin/strato-down
	@rm -f $(HOME)/.local/bin/strato-ps
	@rm -f $(HOME)/.local/bin/strato-patch-app
	@rm -f $(HOME)/.local/bin/strato-user-add
	@rm -f $(HOME)/.local/bin/strato-snapshot
	@rm -f $(HOME)/.local/bin/strato-logrotate
	@rm -f $(HOME)/.local/bin/strato-setup
	@rm -f $(HOME)/.local/bin/convoke
	@echo "Done"

ifeq ($(DOCKER_TAG),)
  $(error DOCKER_TAG is not set)
endif

ifeq ($(STRATO_VERSION),)
  $(error STRATO_VERSION is not set)
endif

all: build

build:
	docker build --build-arg STRATO_VERSION=$(STRATO_VERSION) -t $(DOCKER_TAG) api/
	@if [ -n "$(DOCKER_TAG_ALIAS)" ]; then docker tag $(DOCKER_TAG) $(DOCKER_TAG_ALIAS); fi

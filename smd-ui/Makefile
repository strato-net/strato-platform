ifeq ($(BASIL_DOCKER_TAG),)
  $(error BASIL_DOCKER_TAG is not set)
endif

all: build

build:
	docker build --build-arg STRATO_VERSION=$(STRATO_VERSION) -t $(BASIL_DOCKER_TAG) .

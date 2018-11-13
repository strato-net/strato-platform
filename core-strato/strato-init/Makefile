.DEFAULT_GOAL=build/$(OUTPUT)AccountInfo
build:
	mkdir -p build

BASE1=genesisBlocks/gettingStartedGenesis.json
BASE2=build/midGenesis.json

NAME1=MultiStorage
NAME2=StringStorage

SOURCE1=contracts/$(NAME1).sol
SOURCE2=contracts/$(NAME2).sol

BINARY1=build/$(NAME1).bin-runtime
BINARY2=build/$(NAME2).bin-runtime

DATA1=data/multi_storage.json
DATA2=data/string_storage.json

OUTPUT=smokeTest

build/%.bin-runtime: contracts/%.sol | build
	solc $< --overwrite --bin-runtime --evm-version=homestead --output-dir build/

build/midGenesis.json: $(BINARY1) $(DATA1) $(BASE1)
	stack install strato-genesis
	stack exec generate-genesis -- \
		--genesis_file=$(BASE1) \
		--source_file=$(SOURCE1) \
		--bytecode_file=$(BINARY1) \
		--contract_name=$(NAME1) \
		--records_file=$(DATA1) \
		--start=100 \
		--output_file=$@.ugly \
		--output_account_info=build/midAccountInfo
	python -m json.tool $@.ugly > $@

build/finalGenesis.json: $(BINARY2) $(DATA2) $(BASE2)
	stack exec generate-genesis -- \
		--genesis_file=$(BASE2) \
		--source_file=$(SOURCE2) \
		--bytecode_file=$(BINARY2) \
		--contract_name=$(NAME2) \
		--records_file=$(DATA2) \
		--start=200 \
		--output_file=$@.ugly \
		--output_account_info=build/lateAccountInfo
	python -m json.tool $@.ugly > $@

build/$(OUTPUT)AccountInfo: build/finalGenesis.json
	cat build/midAccountInfo build/lateAccountInfo >| $@
	cp $< build/$(OUTPUT)Genesis.json

install:
	cp build/$(OUTPUT)Genesis.json genesisBlocks/
	cp build/$(OUTPUT)AccountInfo genesisBlocks/

clean:
	rm -rf build

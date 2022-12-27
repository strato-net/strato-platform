import {
  openCreateChainOverlay,
  closeCreateChainOverlay,
  openAddMemberModal,
  closeAddMemberModal,
  createChain,
  createChainSuccess,
  createChainFailure,
  resetError,
  compileChainContract,
  compileChainContractSuccess,
  compileChainContractFailure,
  resetContract
} from "../../components/CreateChain/createChain.actions";
import { xabiMock } from "./createChainMock";

describe('CreateChain: action', () => {

  test('open overlay', () => {
    expect(openCreateChainOverlay()).toMatchSnapshot();
  });

  test('close overlay', () => {
    expect(closeCreateChainOverlay()).toMatchSnapshot();
  });

  describe('Add Member Modal', () => {

    test('open overlay', () => {
      expect(openAddMemberModal()).toMatchSnapshot();
    });

    test('close overlay', () => {
      expect(closeAddMemberModal()).toMatchSnapshot();
    });

  })

  describe('create chain', () => {

    const payload = {
      label: 'airline cartel 9',
      members: [{ address: "f11b5c42f5b84efa07f6b0a32c3fc545ff509126", enode: "enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7…4cac9f77166ad92a0@172.16.0.5:30303?discport=30303" }],
      balances: [{ balance: 500000000000000, address: "f11b5c42f5b84efa07f6b0a32c3fc545ff509126" }],
      src: `contract SimpleStorage {
        uint public storedData;
      }`,
      args: { addRule: "MajorityRules", removeRule: "MajorityRules" },
      contractName: 'SimpleStorage',
      vm: false,
      limit: 10,
      offset: 0
    }

    test('request', () => {
      expect(createChain(payload.label, payload.members, payload.balances, payload.src, payload.args, payload.vm, payload.contractName, payload.limit, payload.offset)).toMatchSnapshot();
    });

    test('success', () => {
      expect(createChainSuccess('64885c49cdc6fe5f15975596115a120ec1e9a616e88a22e0be0457f373d75b73')).toMatchSnapshot();
    });

    test('failure', () => {
      expect(createChainFailure('error')).toMatchSnapshot();
    });

  });

  describe('compile chain contract', () => {

    const payload = {
      name: "Governance",
      contract: "contract Governance { string constant addRule = 'MajorityRules'; string constant removeRule = 'MajorityRules' }",
      searchable: false,
      vm: false,
    }

    test('request', () => {
      expect(compileChainContract(payload.label, payload.contract, payload.searchable, payload.vm)).toMatchSnapshot();
    });

    test('success', () => {
      expect(compileChainContractSuccess(xabiMock)).toMatchSnapshot();
    });

    test('failure', () => {
      expect(compileChainContractFailure('error')).toMatchSnapshot();
    });

  });

  test('reset error', () => {
    expect(resetError()).toMatchSnapshot();
  });

  test('reset contract', () => {
    expect(resetContract()).toMatchSnapshot();
  });

});
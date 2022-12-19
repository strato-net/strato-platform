import {
  openAddMemberModal,
  closeAddMemberModal,
  openAddIntegrationModal,
  closeAddIntegrationModal,
  deployDapp,
  deployDappSuccess,
  deployDappFailure,
  resetError,
} from "../../components/DeployDapp/deployDapp.actions";

describe('DeployDapp: action', () => {

  describe('Add Member Modal', () => {

    test('open overlay', () => {
      expect(openAddMemberModal()).toMatchSnapshot();
    });

    test('close overlay', () => {
      expect(closeAddMemberModal()).toMatchSnapshot();
    });

  })

  describe('Add Integration Modal', () => {

    test('open overlay', () => {
      expect(openAddIntegrationModal()).toMatchSnapshot();
    });

    test('close overlay', () => {
      expect(closeAddIntegrationModal()).toMatchSnapshot();
    });

  })

  describe('create chain', () => {

    const payload = {
      label: 'airline cartel 9',
      members: [{ address: "f11b5c42f5b84efa07f6b0a32c3fc545ff509126", enode: "enode://6f8a80d14311c39f35f516fa664deaaaa13e85b2f7…4cac9f77166ad92a0@172.16.0.5:30303?discport=30303" }],
      balances: [{ balance: 500000000000000, address: "f11b5c42f5b84efa07f6b0a32c3fc545ff509126" }],
      integrations: {},
      src: `contract SimpleStorage {
        uint public storedData;
      }`,
      args: { addRule: "MajorityRules", removeRule: "MajorityRules" },
      vm: false,
    }

    test('request', () => {
      expect(deployDapp(payload.label, payload.members, payload.balances, payload.integrations, payload.src, payload.args, payload.vm)).toMatchSnapshot();
    });

    test('success', () => {
      expect(deployDappSuccess('64885c49cdc6fe5f15975596115a120ec1e9a616e88a22e0be0457f373d75b73')).toMatchSnapshot();
    });

    test('failure', () => {
      expect(deployDappFailure('error')).toMatchSnapshot();
    });

  });

  test('reset error', () => {
    expect(resetError()).toMatchSnapshot();
  });

});
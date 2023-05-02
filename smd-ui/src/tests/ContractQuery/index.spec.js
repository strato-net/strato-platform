import React from 'react';
import ContractQuery, { mapStateToProps } from "../../components/ContractQuery";
import { queryCirrusMock, queryCirrusVarsMock, matchMock } from './contractQueryMock';

describe('ContractQuery: index', () => {
  let mockFunc;

  beforeEach(() => {
    mockFunc = {
      clearQueryString: jest.fn(),
      queryCirrusVars: jest.fn(),
      queryCirrus: jest.fn(),
      addQueryFilter: jest.fn(),
      removeQueryFilter: jest.fn()
    }
  });

  describe('renders with', () => {

    test('empty values', () => {
      const props = {
        match: {
          params: {
            name: null
          }
        },
        contractQuery: {
          queryString: '',
          queryResults: null,
          tags: [],
          vars: null,
          error: null,
          selectedChain: null
        },
        ...mockFunc
      };
      const wrapper = shallow(
        <ContractQuery.WrappedComponent {...props} />
      );
      expect(wrapper).toMatchSnapshot();
    });

    test('query result, vars and filter tags', () => {
      const props = {
        ...matchMock,
        ...mockFunc,
        contractQuery: {
          queryString: 'state=eq.1&amount=eq.5678&name=eq.P',
          queryResults: queryCirrusMock,
          tags: [
            {
              field: "state",
              operator: "eq",
              value: "1",
              display: "state eq 1"
            },
            {
              field: "amount",
              operator: "eq",
              value: "5678",
              display: "amount eq 5678"
            },
            {
              display: "name eq P",
              field: "name",
              operator: "eq",
              value: "P"
            }
          ],
          selectedChain: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
          vars: queryCirrusVarsMock.xabi.vars,
          error: null
        },
      };
      const wrapper = shallow(
        <ContractQuery.WrappedComponent {...props} />
      );
      expect(props.queryCirrus).toHaveBeenCalled();
      expect(props.queryCirrus.mock.calls.length).toBe(1);
      expect(wrapper).toMatchSnapshot();
    });

  });

  describe('tag', () => {

    test('add new one', () => {
      const props = {
        ...matchMock,
        ...mockFunc,
        contractQuery: {
          queryString: 'state=eq.1&amount=eq.5678&name=eq.P',
          queryResults: queryCirrusMock,
          tags: [
            {
              field: "state",
              operator: "eq",
              value: "1",
              display: "state eq 1"
            },
            {
              field: "amount",
              operator: "eq",
              value: "5678",
              display: "amount eq 5678"
            },
            {
              display: "name eq P",
              field: "name",
              operator: "eq",
              value: "P"
            }
          ],
          selectedChain: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
          vars: queryCirrusVarsMock.xabi.vars,
          error: null
        },
      };
      const wrapper = shallow(
        <ContractQuery.WrappedComponent {...props} />
      );
      wrapper.find('select').at(0).simulate('change', { target: { value: 'state' } });
      wrapper.find('select').at(1).simulate('change', { target: { value: '=' } });
      wrapper.find('input').at(3).simulate('change', { target: { value: 2 } });
      wrapper.find('input').at(3).simulate('keyup', { target: { value: 2 }, key: 'Enter' });
      wrapper.find('button').at(0).simulate('click');
      expect(props.addQueryFilter).toHaveBeenCalled();
      expect(props.addQueryFilter.mock.calls.length).toBe(2);
      expect(wrapper.state()).toMatchSnapshot();
    });

    test('remove existing one', () => {
      const props = {
        ...matchMock,
        ...mockFunc,
        contractQuery: {
          queryString: 'state=eq.1&amount=eq.5678&name=eq.P',
          queryResults: queryCirrusMock,
          tags: [
            {
              field: "state",
              operator: "eq",
              value: "1",
              display: "state eq 1"
            },
            {
              field: "amount",
              operator: "eq",
              value: "5678",
              display: "amount eq 5678"
            },
            {
              display: "name eq P",
              field: "name",
              operator: "eq",
              value: "P"
            }
          ],
          selectedChain: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
          vars: queryCirrusVarsMock.xabi.vars,
          error: null
        }
      };
      const wrapper = shallow(
        <ContractQuery.WrappedComponent {...props} />
      );
      wrapper.find('button').at(1).simulate('click');
      expect(props.removeQueryFilter).toHaveBeenCalled();
      expect(props.removeQueryFilter.mock.calls.length).toBe(1);
    });

  });

  describe('Buttons: ', () => {

    test('will trigger back button', () => {
      const props = {
        ...matchMock,
        ...mockFunc,
        contractQuery: {
          queryString: '',
          queryResults: queryCirrusMock,
          tags: [],
          vars: queryCirrusVarsMock.xabi.vars,
          error: null
        },
        history: {
          goBack: jest.fn()
        }
      };
      const wrapper = shallow(
        <ContractQuery.WrappedComponent {...props} />
      );
      wrapper.find('Button').at(0).simulate('click');
      expect(props.history.goBack).toHaveBeenCalled();
      expect(props.history.goBack.mock.calls.length).toBe(1);
      expect(wrapper).toMatchSnapshot();
    });

    test('form submit button be disabled', () => {
      const props = {
        ...matchMock,
        ...mockFunc,
        contractQuery: {
          queryString: '',
          queryResults: queryCirrusMock,
          tags: [],
          vars: queryCirrusVarsMock.xabi.vars,
          error: null
        }
      };
      const wrapper = shallow(
        <ContractQuery.WrappedComponent {...props} />
      );
      wrapper.find('input').at(3).simulate('keyup', { target: { value: 2 }, key: 'Enter' });
      expect(props.addQueryFilter).not.toHaveBeenCalled();
    });

  });

  describe('Table: ', () => {

    test('render with TruncatedFormat column', () => {
      const props = {
        ...matchMock,
        ...mockFunc,
        contractQuery: {
          queryString: 'state=eq.1&amount=eq.5678&name=eq.P',
          queryResults: queryCirrusMock,
          tags: [
            {
              field: "state",
              operator: "eq",
              value: "1",
              display: "state eq 1"
            },
            {
              field: "amount",
              operator: "eq",
              value: "5678",
              display: "amount eq 5678"
            },
            {
              display: "name eq P",
              field: "name",
              operator: "eq",
              value: "P"
            }
          ],
          selectedChain: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
          vars: queryCirrusVarsMock.xabi.vars,
          error: null
        }
      };
      const wrapper = shallow(
        <ContractQuery.WrappedComponent {...props} />
      );
      expect(wrapper.find('Column').get(0).key).toBe('column-address');
      expect(wrapper.find('Column').get(0).props.renderCell(2)).toMatchSnapshot();
      expect(wrapper.find('Column').get(1).key).toBe('column-amount');
      expect(wrapper.find('Column').get(1).props.renderCell(1)).toMatchSnapshot();
      expect(wrapper.find('Column').debug()).toMatchSnapshot();
    });

    test('render with JSON format column', () => {
      const props = {
        ...matchMock,
        ...mockFunc,
        contractQuery: {
          queryString: 'state=eq.1&amount=eq.5678&name=eq.P',
          queryResults: queryCirrusMock,
          tags: [
            {
              field: "state",
              operator: "eq",
              value: "1",
              display: "state eq 1"
            },
            {
              field: "amount",
              operator: "eq",
              value: "5678",
              display: "amount eq 5678"
            },
            {
              display: "name eq P",
              field: "name",
              operator: "eq",
              value: "P"
            }
          ],
          vars: {
            ...queryCirrusVarsMock.xabi.vars, "newColumn": {
              "atBytes": 0,
              "signed": false,
              "type": "Array",
              "bytes": 32,
              "public": true
            }
          },
          selectedChain: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9",
          error: null
        }
      };
      const wrapper = shallow(
        <ContractQuery.WrappedComponent {...props} />
      );
      expect(wrapper.find('Column').debug()).toMatchSnapshot();
    });

  });

  describe('componentWillReceiveProps: ', () => {

    test('invoke with truthy statement', () => {
      const props = {
        ...matchMock,
        ...mockFunc,
        contractQuery: {
          queryString: 'state=eq.1&amount=eq.5678',
          queryResults: queryCirrusMock,
          tags: [
            {
              field: "state",
              operator: "eq",
              value: "1",
              display: "state eq 1"
            },
            {
              field: "amount",
              operator: "eq",
              value: "5678",
              display: "amount eq 5678"
            }
          ],
          vars: queryCirrusVarsMock.xabi.vars,
          error: null,
          selectedChain: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9"
        }
      };
      const newProps = {
        contractQuery: {
          queryString: 'state=eq.1&amount=eq.5678&name=eq.P',
        },
        ...matchMock
      };
      const wrapper = shallow(
        <ContractQuery.WrappedComponent {...props} />
      );
      wrapper.instance().componentWillReceiveProps(newProps);
      expect(props.queryCirrus).toHaveBeenCalled();
      expect(props.queryCirrus.mock.calls.length).toBe(2);
      expect(wrapper).toMatchSnapshot();
    });

    test('invoke with falsy statement', () => {
      const props = {
        ...matchMock,
        ...mockFunc,
        contractQuery: {
          queryString: 'state=eq.1&amount=eq.5678',
          queryResults: queryCirrusMock,
          tags: [
            {
              field: "state",
              operator: "eq",
              value: "1",
              display: "state eq 1"
            },
            {
              field: "amount",
              operator: "eq",
              value: "5678",
              display: "amount eq 5678"
            }
          ],
          vars: queryCirrusVarsMock.xabi.vars,
          error: null
        }
      };
      const newProps = {
        contractQuery: {
          queryString: 'state=eq.1&amount=eq.5678',
        },
        ...matchMock
      };
      const wrapper = shallow(
        <ContractQuery.WrappedComponent {...props} />
      );
      wrapper.instance().componentWillReceiveProps(newProps);
      expect(props.queryCirrus).toHaveBeenCalled();
      expect(props.queryCirrus.mock.calls.length).toBe(1);
      expect(wrapper).toMatchSnapshot();
    });
  });

  describe('mapStateToProps: ', () => {

    test('inspection', () => {
      const state = {
        contractQuery: {
          queryString: '',
          queryResults: queryCirrusMock,
          tags: [],
          vars: queryCirrusVarsMock.xabi.vars,
          error: null,
        },
        chains: {
          selectedChain: "ff7ef45acb7a775018bc765b6fdeea432aaddfcd846cf6dd9442724266b1eac9"
        }
      }
      expect(mapStateToProps(state)).toMatchSnapshot();
    });

  });

  describe('componentWillMount: ', () => {

    test('inspection', () => {
      const props = {
        ...matchMock,
        ...mockFunc,
        contractQuery: {
          queryString: 'state=eq.1&amount=eq.5678',
          queryResults: queryCirrusMock,
          tags: [
            {
              field: "state",
              operator: "eq",
              value: "1",
              display: "state eq 1"
            },
            {
              field: "amount",
              operator: "eq",
              value: "5678",
              display: "amount eq 5678"
            }
          ],
          vars: queryCirrusVarsMock.xabi.vars,
          error: null
        }
      };
      const wrapper = shallow(
        <ContractQuery.WrappedComponent {...props} />
      );
      wrapper.instance().componentWillMount();
      expect(props.clearQueryString).toHaveBeenCalled();
      expect(props.clearQueryString.mock.calls.length).toBe(2);
    });

  });

});
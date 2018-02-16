import reducer from '../../../../components/Accounts/components/SendTokens/sendTokens.reducer';
import {
  sendTokens,
  sendTokensSuccess,
  sendTokensFailure,
  sendTokensOpenModal,
  sendTokensCloseModal,
  toUsernameChange,
  fromUsernameChange
} from '../../../../components/Accounts/components/SendTokens/sendTokens.actions';
import { sendTokensForm, sendTokensResponse, error } from './sendTokensMock';

describe('SendTokens: reducer', () => {

  let initialState

  beforeEach(() => {
    initialState = {
      isOpen: false,
      result: 'Waiting to send...'
    }
  });

  test('set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  test('initiate sendTokensRequest', () => {
    const action = sendTokens(sendTokensForm);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('update tokens on sendTokensRequest success', () => {
    const action = sendTokensSuccess(sendTokensResponse);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('update error on sendTokensRequest failure', () => {
    const action = sendTokensFailure(error);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('modal open', () => {
    const action = sendTokensOpenModal();
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('modal close', () => {
    const action = sendTokensCloseModal();
    const state = {
      isOpen: true,
      result: 'Waiting to send...'
    }
    expect(reducer(state, action)).toMatchSnapshot();
  });

  test('update toUserName', () => {
    const action = toUsernameChange('admin_01555');
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('update fromUserName', () => {
    const action = fromUsernameChange('admin_01555');
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

});
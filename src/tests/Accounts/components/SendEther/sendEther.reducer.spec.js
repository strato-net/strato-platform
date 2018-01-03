import reducer from '../../../../components/Accounts/components/SendEther/sendEther.reducer';
import {
  sendEther,
  sendEtherSuccess,
  sendEtherFailure,
  sendEtherOpenModal,
  sendEtherCloseModal,
  toUsernameChange,
  fromUsernameChange
} from '../../../../components/Accounts/components/SendEther/sendEther.actions';
import { sendEtherForm, sendEtherResponse, error } from './sendEtherMock';

describe('SendEther: reducer', () => {

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

  test('initiate sendEtherRequest', () => {
    const action = sendEther(sendEtherForm);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('update ether on sendEtherRequest success', () => {
    const action = sendEtherSuccess(sendEtherResponse);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('update error on sendEtherRequest failure', () => {
    const action = sendEtherFailure(error);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('modal open', () => {
    const action = sendEtherOpenModal();
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('modal close', () => {
    const action = sendEtherCloseModal();
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
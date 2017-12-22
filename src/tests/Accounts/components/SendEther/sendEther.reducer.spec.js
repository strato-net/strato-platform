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

describe('Test sendEther reducer', () => {

  const initialState = {
    isOpen: false,
    result: 'Waiting to send...'
  }

  test('should set initial state', () => {
    expect(reducer(undefined, {})).toMatchSnapshot();
  });

  test('should initiate sendEtherRequest', () => {
    const action = sendEther(sendEtherForm);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('should store ether after sendEtherRequest success', () => {
    const action = sendEtherSuccess(sendEtherResponse);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('should update error after sendEtherRequest failure', () => {
    const action = sendEtherFailure(error);
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('should change isOpen state on sendEther modal open', () => {
    const action = sendEtherOpenModal();
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('should change isOpen state on sendEther modal close', () => {
    const action = sendEtherCloseModal();

    const state = {
      isOpen: true,
      result: 'Waiting to send...'
    }

    expect(reducer(state, action)).toMatchSnapshot();
  });

  test('should store toUserName', () => {
    const action = toUsernameChange('admin_01555');
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

  test('should store fromUserName', () => {
    const action = fromUsernameChange('admin_01555');
    expect(reducer(initialState, action)).toMatchSnapshot();
  });

});
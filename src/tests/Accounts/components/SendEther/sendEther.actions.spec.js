import {
  sendEther,
  fromUsernameChange,
  toUsernameChange,
  sendEtherSuccess,
  sendEtherFailure,
  sendEtherOpenModal,
  sendEtherCloseModal
} from '../../../../components/Accounts/components/SendEther/sendEther.actions';
import { sendEtherResponse, error, sendEtherForm } from './sendEtherMock';

describe('Test sendEther sagas', () => {

  test('should create an action to send ether', () => {
    expect(sendEther({ ...sendEtherForm })).toMatchSnapshot();
  });

  test('should create an action to change fromusername', () => {
    expect(fromUsernameChange(sendEtherForm.from)).toMatchSnapshot();
  });

  test('should create an action to change tousername', () => {
    expect(toUsernameChange(sendEtherForm.from)).toMatchSnapshot();
  });

  test('should return ether after sendEther success', () => {
    expect(sendEtherSuccess(sendEtherResponse)).toMatchSnapshot();
  });

  test('should return error after sendEther failure', () => {
    expect(sendEtherFailure(error)).toMatchSnapshot();
  });

  test('should create an action to open sendEther modal', () => {
    expect(sendEtherOpenModal()).toMatchSnapshot();
  });

  test('should create an action to close sendEther modal', () => {
    expect(sendEtherCloseModal()).toMatchSnapshot();
  });

});
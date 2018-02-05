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

describe('SendEther: action', () => {

  test('send ether', () => {
    expect(sendEther({ ...sendEtherForm })).toMatchSnapshot();
  });

  test('change fromUsername', () => {
    expect(fromUsernameChange(sendEtherForm.from)).toMatchSnapshot();
  });

  test('change toUsername', () => {
    expect(toUsernameChange(sendEtherForm.from)).toMatchSnapshot();
  });

  test('sendEther success', () => {
    expect(sendEtherSuccess(sendEtherResponse)).toMatchSnapshot();
  });

  test('sendEther failure', () => {
    expect(sendEtherFailure(error)).toMatchSnapshot();
  });

  test('open sendEther modal', () => {
    expect(sendEtherOpenModal()).toMatchSnapshot();
  });

  test('close sendEther modal', () => {
    expect(sendEtherCloseModal()).toMatchSnapshot();
  });

});
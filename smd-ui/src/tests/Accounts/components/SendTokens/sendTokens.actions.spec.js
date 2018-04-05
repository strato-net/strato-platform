import {
  sendTokens,
  fromUsernameChange,
  toUsernameChange,
  sendTokensSuccess,
  sendTokensFailure,
  sendTokensOpenModal,
  sendTokensCloseModal
} from '../../../../components/Accounts/components/SendTokens/sendTokens.actions';
import { sendTokensResponse, error, sendTokensForm } from './sendTokensMock';

describe('SendTokens: action', () => {

  test('send tokens', () => {
    expect(sendTokens({ ...sendTokensForm })).toMatchSnapshot();
  });

  test('change fromUsername', () => {
    expect(fromUsernameChange(sendTokensForm.from)).toMatchSnapshot();
  });

  test('change toUsername', () => {
    expect(toUsernameChange(sendTokensForm.from)).toMatchSnapshot();
  });

  test('sendTokens success', () => {
    expect(sendTokensSuccess(sendTokensResponse)).toMatchSnapshot();
  });

  test('sendTokens failure', () => {
    expect(sendTokensFailure(error)).toMatchSnapshot();
  });

  test('open sendTokens modal', () => {
    expect(sendTokensOpenModal()).toMatchSnapshot();
  });

  test('close sendTokens modal', () => {
    expect(sendTokensCloseModal()).toMatchSnapshot();
  });

});
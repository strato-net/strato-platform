import { createUrl } from '../../lib/url';

describe('Lib: url', () => {

  test('create url', () => {
    const baseUrl = 'http://localhost/user/::username/::address';
    const options = { params: { username: 'clinicalops', address: '0X22255555' }, query: { chainid: '54216454215454', resolve: true } };
    expect(createUrl(baseUrl, options)).toMatchSnapshot();
  });

  test('create url (query only)', () => {
    const baseUrl = 'http://localhost/user';
    const options = { query: { chainid: '54216454215454', resolve: true } };
    expect(createUrl(baseUrl, options)).toMatchSnapshot();
  });

  test('create url (params only)', () => {
    const baseUrl = 'http://localhost/user/::username/::address';
    const options = { params: { username: 'clinicalops', address: '0X22255555' } };
    expect(createUrl(baseUrl, options)).toMatchSnapshot();
  });

  test('create url (null values should not be append)', () => {
    /*
     HERE: If chainid is null that will not be appended as a query
     Also: resolve: false will not be append as a query
    */
    const baseUrl = 'http://localhost/user/::username/::address';
    const options = { params: { username: 'clinicalops', address: '0X22255555' }, query: { chainid: null, resolve: false } };
    expect(createUrl(baseUrl, options)).toMatchSnapshot();
  });

  test('Empty options', () => {
    const baseUrl = 'http://localhost/user';
    expect(createUrl(baseUrl)).toMatchSnapshot();
  });

});

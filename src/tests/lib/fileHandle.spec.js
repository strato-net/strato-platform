import {downloadFile} from '../../lib/fileHandler'

describe('Lib: file download', () => {

  test('download file', () => {
    expect(downloadFile('test','this is sample test file download')).toMatchSnapshot();
  });

});
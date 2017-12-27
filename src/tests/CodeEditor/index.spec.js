import React from 'react';
import CodeEditor, { mapStateToProps } from '../../components/CodeEditor/index';
import { extAbi, error, selectedTabContent, codeEditor, sourceCodeUndefinedImport } from './codeEditorMock';

describe('Test CodeEditor index', () => {
  let files
  beforeAll(() => {
    files = [
      {
        lastModified: 1510307249786,
        name: "abc.sol",
        preview: "blob:http://localhost:3000/20bcc325-c169-484f-8739-4f888fe68295",
        size: 7,
        type: "",
        webkitRelativePath: ""
      }
    ]
  });

  test('should render codeeditor with default values', () => {
    const props = {
      selectedTabContent: selectedTabContent,
      codeEditorData: codeEditor
    }
    const wrapper = shallow(
      <CodeEditor.WrappedComponent {...props} />
    );

    expect(wrapper).toMatchSnapshot();
  });

  test('should test mapStateToProps', () => {
    const state = {
      codeEditor: codeEditor
    }

    expect(mapStateToProps(state)).toMatchSnapshot();
  });

  test('should test events', () => {
    const props = {
      selectedTabContent: selectedTabContent,
      codeEditorData: codeEditor,
      onCompileFileLocally: jest.fn(),
      removeTab: jest.fn(),
      changeCreateActionState: jest.fn(),
      onTabChange: jest.fn(),
      onChangeFileName: jest.fn(),
      addNewFileTab: jest.fn()
    }

    const wrapper = shallow(
      <CodeEditor.WrappedComponent {...props} />
    );
    const popOver = wrapper.find('Popover')
    wrapper.find('Button').at(0).simulate('click')
    expect(props.onCompileFileLocally).toHaveBeenCalled()
    wrapper.find('Button').at(1).simulate('click')
    wrapper.find('Button').at(2).simulate('click')
    wrapper.find('Button').at(3).simulate('click')

    wrapper.find('span').at(0).simulate('click')
    expect(props.removeTab).toHaveBeenCalled()

    const monacoEditor = wrapper.find('Tab2').at(1).dive().find('MonacoEditor')
    monacoEditor.simulate('change', { target: { value: 'abc', index: 1 } })
    expect(props.changeCreateActionState).toHaveBeenCalled()

    wrapper.find('Tabs2').at(0).simulate('change', { target: { newTab: 1, prevTab: 0 } })
    expect(props.onTabChange).toHaveBeenCalled()

    const input = popOver.dive().find('input')
    expect(input.value).toBe(undefined)
    input.simulate('change', { target: { value: 'tanuj' } })
    expect(props.onChangeFileName).toHaveBeenCalled()

    const button = popOver.dive().find('Overlay').find('Button')
    button.simulate('click')
    expect(props.addNewFileTab).toHaveBeenCalled()

    props.codeEditorData['sourceCode'] = undefined
    wrapper.find('Button').at(0).simulate('click')
    expect(props.onCompileFileLocally).toHaveBeenCalled()

    props.codeEditorData['sourceCode'] = sourceCodeUndefinedImport
    wrapper.find('Button').at(0).simulate('click')
    expect(props.onCompileFileLocally).toHaveBeenCalled()

  });

  test('should test file drop', () => {
    const props = {
      selectedTabContent: selectedTabContent,
      codeEditorData: codeEditor,
      onCompileFileLocally: jest.fn(),
      removeTab: jest.fn(),
      changeCreateActionState: jest.fn(),
      onTabChange: jest.fn(),
      onChangeFileName: jest.fn(),
      addNewFileTab: jest.fn()
    }

    const wrapper = shallow(
      <CodeEditor.WrappedComponent {...props} />
    );
    const dropzone = wrapper.find('Dropzone')
  });

})
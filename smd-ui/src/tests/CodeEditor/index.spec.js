import React from 'react';
import CodeEditor, { mapStateToProps } from '../../components/CodeEditor/index';
import { extAbi, error, selectedTabContent, codeEditor, sourceCodeUndefinedImport } from './codeEditorMock';

describe('CodeEditor: index', () => {
  let files
  const readAsText = jest.fn();

  beforeAll(() => {
    localStorage.clear();
    files = [
      {
        name: 'file1.sol',
        size: 1111,
        type: ''
      }
    ]
    const fileContents = 'file contents';
    const expectedFinalState = { fileContents: fileContents };
    const file = new Blob([fileContents], { type: 'text/plain' });
    const addEventListener = jest.fn((_, evtHandler) => { evtHandler(); });
    const dummyFileReader = { addEventListener, readAsText, result: fileContents };
    window.FileReader = jest.fn(() => dummyFileReader);
  });

  test('render codeEditor with default values', () => {
    const props = {
      selectedTabContent: selectedTabContent,
      codeEditorData: codeEditor
    }
    const wrapper = shallow(
      <CodeEditor.WrappedComponent {...props} />
    );
    expect(wrapper).toMatchSnapshot();
  });

  test('mapStateToProps with default values', () => {
    const state = {
      codeEditor: codeEditor
    }
    expect(mapStateToProps(state)).toMatchSnapshot();
  });

  test('simulate events', () => {
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

  test('.sol file drop', () => {
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
    dropzone.simulate('drop', files)
    expect(readAsText).toHaveBeenCalled()

  });

  test('other file eg. text file drop', () => {
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
    files[0]['name'] = 'pqr.txt'
    const dropzone = wrapper.find('Dropzone')
    dropzone.simulate('drop', files)
    expect(readAsText).toHaveBeenCalled()
  });

  test('multiple file drop', () => {
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
    files.push({
      name: 'file2.sol',
      size: 1111,
      type: ''
    })
    const dropzone = wrapper.find('Dropzone')
    dropzone.simulate('drop', files)
    expect(readAsText).toHaveBeenCalled()
  });

  test('local storage', () => {
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
    var wrapper = shallow(
      <CodeEditor.WrappedComponent {...props} />, { lifecycleExperimental: true }
    );
    window.onbeforeunload()
    expect(Object.keys(localStorage.__STORE__).length).toBe(1)
  });

  test('save local state method call', () => {
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
    const options = {
      lifecycleExperimental: true,
      disableLifecycleMethods: false
    };
    var wrapper = shallow(
      <CodeEditor.WrappedComponent {...props} />, options
    );
    wrapper.instance().saveLocalState = jest.fn()
    wrapper.instance().componentDidUpdate()
    expect(wrapper.instance().saveLocalState).toHaveBeenCalled()
  });

})
import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import MonacoEditor from 'react-monaco-editor';
import { Button, Tab2, Tabs2, Popover } from '@blueprintjs/core';
import { contractNameChange, compileCodeFromEditor, changeCreateActionState, addNewFileTab, removeTab, onTabChange } from './codeEditor.actions';
import CreateContract from '../CreateContract';
import { getImportStatements, getFileAndReplaceWithImport } from '../../lib/FileParser.js'

class CodeEditor extends Component {
  constructor() {
    super()
    this.state = {
      fileName: undefined,
      localCompileException: ''
    }
    this.timeout = null;
  }

  componentDidMount() {
    mixpanelWrapper.track('code_editor_load');
  }

  renderPopUpContent = () => {
    return <div className="row">
      <input
        className="pt-input .modifier"
        type="text"
        placeholder="Enter file name"
        dir="auto"
        onChange={(e) => this.setState({ fileName: e.target.value })} />
      <Button
        className="pt-intent-primary pt-popover-dismiss"
        text="Add file"
        onClick={() => {
          this.state.fileName && this.state.fileName.length > 0 && this.props.addNewFileTab(this.state.fileName)
        }} />
    </div>
  }

  onTextUpdate() {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      this.compileCode();
    }, 3000);
  }

  compileCode() {
    this.setState({ localCompileException: '' })
    try {
      if (this.props.codeEditorData.sourceCode === undefined || this.props.codeEditorData.sourceCode.length === 0) {
        throw new Error("Can't compile. Source is undefined")
      }
      const code = getFileAndReplaceWithImport(this.props.codeEditorData.sourceCode, this.props.codeEditorData.tab)
      const newFileList = getImportStatements(code)
      if (newFileList.length > 0) {
        throw new Error("Can't find the imported file.")
      }
      mixpanelWrapper.track("compile_contract_code_click");
      this.props.compileCodeFromEditor(
        'Greeter',
        code,
        false
      );
    } catch (e) {
      this.setState({ localCompileException: `${e}` })
    }
  }

  render() {
    const options = {
      theme: 'vs-dark',
      automaticLayout: true
    };
    const requireConfig = {
      url: 'https://cdnjs.cloudflare.com/ajax/libs/require.js/2.3.1/require.min.js',
      paths: {
        vs: 'vs'
      }
    };
    var sourceCode = undefined
    try {
      sourceCode = this.props.codeEditorData.sourceCode &&
        getFileAndReplaceWithImport(this.props.codeEditorData.sourceCode, this.props.codeEditorData.tab)
    } catch (e) {
      console.log('Exception')
    }
    const tabData = this.props.codeEditorData.tab
    const tabMenus = tabData.map((item, index) => {
      return <Tab2 id={index} key={index} title={item.title} panel={<MonacoEditor
        className="col-md-4 text-center"
        width={'100%'}
        height={window.innerHeight - 320 < 480 ? 480 : window.innerHeight - 320}
        value={item.text}
        language="sol"
        requireConfig={requireConfig}
        options={options}
        onChange={(value, e) => {
          this.props.changeCreateActionState(false, value, index);
          this.onTextUpdate();
        }} />}>
        <span className="pt-icon-standard pt-icon-cross pt-align-right smd-pad-8"
          onClick={() => {
            this.props.removeTab(index)
          }}>
        </span>
      </Tab2>
    })
    return (
      <div className="container-fluid pt-dark">
        <div className="row">
          <div className="col-md-4 text-left">
            <h3>Contract Editor</h3>
          </div>
          <div className="col-md-8 text-right">
            <Button onClick={() => this.compileCode()} className="pt-intent-primary"
              text="Compile" />
            <CreateContract
              onChangeEditorContractName={this.props.contractNameChange}
              contractNameFromEditor={this.props.codeEditorData.contractName}
              enableCreateContract={this.props.codeEditorData.enableCreateAction}
              textFromEditor={sourceCode}
              sourceFromEditor={this.props.codeEditorData.response && this.props.codeEditorData.response.src} />
          </div>
        </div>
        <div className="row smd-pad-vertical-4">
          <div className="col-md-4">
            <Popover
              content={this.renderPopUpContent()}
              popoverClassName={"popoverClassName"}
              popoverWillClose={() => this.setState({
                fileName: undefined
              })}
            >
              <Button className="pt-icon-add"
                text="Add File"
              />
            </Popover>
          </div>
        </div>
        <div className="row">
          <div className="col-md-12">
            <Tabs2
              id="editor-tab"
              selectedTabId={this.props.codeEditorData.currentTabSelected}
              onChange={(newTab, prevTab, event) => this.props.onTabChange(prevTab, newTab)}>
              {tabMenus}
            </Tabs2>
          </div>
        </div>
        <div className="row">
          <div className="col-md-12">
            <pre className="pt-text-muted" style={{ height: '110px', fontSize: '11px' }}>
              {
                this.state.localCompileException.length > 0 ? this.state.localCompileException : (this.props.codeEditorData.codeCompileSuccess
                  ? ' Contract compiled successfully'
                  : this.props.codeEditorData.response
                    ? ' ' + this.props.codeEditorData.response
                    : '')
              }
            </pre>
          </div>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return { codeEditorData: state.codeEditor };
}

export default withRouter(connect(mapStateToProps, { contractNameChange, compileCodeFromEditor, changeCreateActionState, addNewFileTab, removeTab, onTabChange })(CodeEditor));
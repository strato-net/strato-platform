import React, {Component} from 'react';
import {connect} from 'react-redux';
import {withRouter} from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import MonacoEditor from 'react-monaco-editor';
import {Button, Tab2, Tabs2} from '@blueprintjs/core';
import {compileCodeFromEditor, changeCreateActionState} from './codeEditor.actions';
import CreateContract from '../CreateContract';

class CodeEditor extends Component {

  componentDidMount() {
    mixpanelWrapper.track('code_editor_load');
  }

  render() {
    const options = {
      theme: 'vs-dark',
      automaticLayout: true
    };
    const requireConfig = {
      url: 'https://cdnjs.cloudflare.com/ajax/libs/require.js/2.3.1/require.min.js',
      paths: {
        vs: 'https://as.alipayobjects.com/g/cicada/monaco-editor-mirror/0.6.1/min/vs'
      }
    };
    return (
      <div className="container-fluid">
        <div className="row pt-dark">
          <div className="row">
            <div className="col-md-4 text-left">
              <h3>Contract Editor</h3>
            </div>
            <div className="col-md-8 text-right smd-pad-8">
              <div className="smd-pad-8">
                <Button onClick={() => {
                  mixpanelWrapper.track("code_editor_compile_click");
                  this.props.compileCodeFromEditor('Greeter', this.props.codeEditorData.sourceCode, false);
                }} className="pt-intent-primary" text="Compile"/>
                <CreateContract contractNameFromEditor={this.props.codeEditorData.contractName} enableCreateContract={this.props.codeEditorData.enableCreateAction} textFromEditor={this.props.codeEditorData.sourceCode} sourceFromEditor={this.props.codeEditorData.response && this.props.codeEditorData.response.src}/>
              </div>
            </div>
          </div>
          <div className="row" style={{
            margin: 20
          }}>
            <Tabs2 id="Tabs2Example">
              <Tab2 id={1} title={'Main.sol'} panel={< MonacoEditor className = "col-md-4 text-center" width = {
                '100%'
              }
              defaultValue = {
                this.props.codeEditorData.sourceCode
              }
              height = "400" language = 'solidity' requireConfig = {
                requireConfig
              }
              editorWillMount = {
                this.editorWillMount
              }
              options = {
                options
              }
              onChange = {
                (value, e) => {
                  this.props.changeCreateActionState(false, value)
                }
              } />}/>
            </Tabs2>
          </div>
          <div style={{
            margin: 20
          }}>
            Result: {this.props.codeEditorData.codeCompileSuccess
              ? ' Contract compiled successfully'
              : this.props.codeEditorData.response
                ? ' ' + this.props.codeEditorData.response
                : ''}
          </div>
        </div>
      </div>
    );
  }
}

function mapStateToProps(state) {
  return {codeEditorData: state.codeEditor};
}

export default withRouter(connect(mapStateToProps, {compileCodeFromEditor, changeCreateActionState})(CodeEditor));

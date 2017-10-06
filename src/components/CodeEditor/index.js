import React, { Component } from 'react';
import { connect } from 'react-redux';
import { withRouter } from 'react-router-dom';
import mixpanelWrapper from '../../lib/mixpanelWrapper';
import MonacoEditor from 'react-monaco-editor';

class CodeEditor extends Component {
    constructor(props) {
        super(props);
        const jsonCode = [
            '{',
            '    "$schema": "http://myserver/foo-schema.json"',
            '}'
        ].join('\n');
        this.state = {
            code: jsonCode,
        }
    }

    render() {
        const code = this.state.code;
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
                    <div className="col-md-3 text-left">
                        <h3>Contracts</h3>
                    </div>
                    </div>
                    <div className="row">
                    <MonacoEditor
                        width={'80%'}
                        height="500"
                        language="sol"
                        defaultValue={code}
                        requireConfig={requireConfig}
                        editorWillMount={this.editorWillMount}
                    />
                    </div>
                </div>
                
            </div>
        );
    }
}

function mapStateToProps(state) {
    return {
        contracts: state.contracts.contracts,
        filter: state.contracts.filter
    };
}

export default withRouter(connect(mapStateToProps, null)(CodeEditor));

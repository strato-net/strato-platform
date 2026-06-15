export function getImportStatements(source) {
    const splittedSource = source.split("\n")
    // TODO: This does not guard against multiline strings or comments
    const newImports = splittedSource.filter((line) => /^\s*import /.test(line))
    const newFileList = []
    newImports.map((item) => {
        const splittedItem = item.split(' ')
        const filename = splittedItem.filter((word) => word.includes('.sol'))
        newFileList.push(filename.length > 0 && filename[0].replace(/['";]+/g, ''))
        return item
    })
    return newFileList
}

export function replaceImportStatementsWithSource(source, importsCode, tabData) {
    const splittedSource = source.split("\n")
    const filteredList = splittedSource.map((item) => {
        const code = importsCode.filter(
            (codeItem) =>
                item.includes(codeItem.title)
        )
        return code.length > 0 ? getFileAndReplaceWithImport(code[0].text, tabData) : item }
    )
    filteredList.join("\r\n")
    return filteredList
}

export function getFileAndReplaceWithImport(code, tabData) {
    const newFileList = getImportStatements(code)
    if (newFileList.length === 0) {
        return code
    }
    const items = tabData.filter((item) =>
        newFileList.includes(item.title)
    )
    const replacedCode = replaceImportStatementsWithSource(code, items, tabData)
    return replacedCode.join("\r\n")
}

/**
 * This transformer turns doctests in comments into actual code
 */

import type * as ts from "typescript"
import fs from "fs"
import type { ProgramTransformerExtras, PluginConfig } from "ts-patch"
import { getPatchedHost } from "../../common/transformer/utils"
import { parseDoctests } from "../parser"
import { DoctestCodeGenerator } from "../code-generator"
import { assertionCodeGenerator } from "../code-generator/assertionCodeGenerator"
import { removeDoctestsFromSourceFile } from "../removeDoctestsFromSourceFile"

const doctestCodeGenerator: DoctestCodeGenerator = assertionCodeGenerator

export default function transformProgram(
  program: ts.Program,
  host: ts.CompilerHost | undefined,
  options: PluginConfig,
  { ts: tsInstance }: ProgramTransformerExtras
): ts.Program {
  const compilerOptions = program.getCompilerOptions()
  const compilerHost = getPatchedHost(host, tsInstance, compilerOptions)
  const rootFileNames = program.getRootFileNames()

  /* Render modified files and create new SourceFiles for them to use in host's cache */
  const { printFile } = tsInstance.createPrinter()

  for (const sourceFile of program.getSourceFiles()) {
    const { fileName, languageVersion } = sourceFile
    if (fileName.includes("node_modules")) continue
    const sourceString = printFile(sourceFile)

    const originalSourceString = fs.readFileSync(fileName).toString()

    // We parse the doctests from the parsed AST in order to remove them
    // from the chain and not process them again
    const parsedSourceFileDoctests = parseDoctests({
      path: fileName,
      content: sourceString
    })
    if (!parsedSourceFileDoctests.length) continue

    // We parse the doctests from the original file in order to get
    // the correct line numbers
    const doctests = parseDoctests({
      content: originalSourceString,
      path: fileName
    })

    const newSourceString =
      removeDoctestsFromSourceFile({
        sourceString,
        doctests: parsedSourceFileDoctests
      }) +
      "\n" +
      doctestCodeGenerator.generate({ doctests })

    const updatedSourceFile = tsInstance.createSourceFile(
      fileName,
      newSourceString,
      languageVersion
    )

    compilerHost.fileCache.set(fileName, { ...sourceFile, ...updatedSourceFile })
  }

  /* Re-create Program instance */
  return tsInstance.createProgram(rootFileNames, compilerOptions, compilerHost)
}

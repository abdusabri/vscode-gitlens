'use strict';
import {CancellationToken, CodeLens, CodeLensProvider, commands, Location, Position, Range, SymbolInformation, SymbolKind, TextDocument, Uri} from 'vscode';
import {Commands, VsCodeCommands} from './constants';
import {IGitBlameLine, gitBlame} from './git';
import {toGitBlameUri} from './gitBlameUri';
import * as moment from 'moment';

export class GitBlameCodeLens extends CodeLens {
    constructor(private blame: Promise<IGitBlameLine[]>, public repoPath: string, public fileName: string, private blameRange: Range, range: Range) {
        super(range);
    }

    getBlameLines(): Promise<IGitBlameLine[]> {
        return this.blame.then(allLines => allLines.slice(this.blameRange.start.line, this.blameRange.end.line + 1));
    }

    static toUri(lens: GitBlameCodeLens, index: number, line: IGitBlameLine, lines: IGitBlameLine[], commits: string[]): Uri {
        return toGitBlameUri(Object.assign({ repoPath: lens.repoPath, index: index, range: lens.blameRange, lines: lines, commits: commits }, line));
    }
}

export class GitHistoryCodeLens extends CodeLens {
    constructor(public repoPath: string, public fileName: string, range: Range) {
        super(range);
    }

    // static toUri(lens: GitHistoryCodeLens, index: number): Uri {
    //     return toGitBlameUri(Object.assign({ repoPath: lens.repoPath, index: index, range: lens.blameRange, lines: lines }, line));
    // }
}

export default class GitCodeLensProvider implements CodeLensProvider {
    constructor(public repoPath: string) { }

    provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
        // TODO: Should I wait here?
        const blame = gitBlame(document.fileName);

        return (commands.executeCommand(VsCodeCommands.ExecuteDocumentSymbolProvider, document.uri) as Promise<SymbolInformation[]>).then(symbols => {
            let lenses: CodeLens[] = [];
            symbols.forEach(sym => this._provideCodeLens(document, sym, blame, lenses));

            // Check if we have a lens for the whole document -- if not add one
            if (!lenses.find(l => l.range.start.line === 0 && l.range.end.line === 0)) {
                const docRange = document.validateRange(new Range(0, 1000000, 1000000, 1000000));
                lenses.push(new GitBlameCodeLens(blame, this.repoPath, document.fileName, docRange, new Range(0, 0, 0, docRange.start.character)));
                lenses.push(new GitHistoryCodeLens(this.repoPath, document.fileName, docRange.with(new Position(docRange.start.line, docRange.start.character + 1))));
            }
            return lenses;
        });
    }

    private _provideCodeLens(document: TextDocument, symbol: SymbolInformation, blame: Promise<IGitBlameLine[]>, lenses: CodeLens[]): void {
        switch (symbol.kind) {
            case SymbolKind.Package:
            case SymbolKind.Module:
            case SymbolKind.Class:
            case SymbolKind.Interface:
            case SymbolKind.Constructor:
            case SymbolKind.Method:
            case SymbolKind.Property:
            case SymbolKind.Field:
            case SymbolKind.Function:
            case SymbolKind.Enum:
                break;
            default:
                return;
        }

        const line = document.lineAt(symbol.location.range.start);
        lenses.push(new GitBlameCodeLens(blame, this.repoPath, document.fileName, symbol.location.range, line.range.with(new Position(line.range.start.line, line.firstNonWhitespaceCharacterIndex))));
        lenses.push(new GitHistoryCodeLens(this.repoPath, document.fileName, line.range.with(new Position(line.range.start.line, line.firstNonWhitespaceCharacterIndex + 1))));
    }

    resolveCodeLens(lens: CodeLens, token: CancellationToken): Thenable<CodeLens> {
        if (lens instanceof GitBlameCodeLens) return this._resolveGitBlameCodeLens(lens, token);
        if (lens instanceof GitHistoryCodeLens) return this._resolveGitHistoryCodeLens(lens, token);
    }

    _resolveGitBlameCodeLens(lens: GitBlameCodeLens, token: CancellationToken): Thenable<CodeLens> {
        return new Promise<CodeLens>((resolve, reject) => {
            lens.getBlameLines().then(lines => {
                if (!lines.length) {
                    console.error('No blame lines found', lens);
                    reject(null);
                    return;
                }

                let recentLine = lines[0];

                let locations: Location[] = [];
                if (lines.length > 1) {
                    let sorted = lines.sort((a, b) => b.date.getTime() - a.date.getTime());
                    recentLine = sorted[0];

                    // console.log(lens.fileName, 'Blame lines:', sorted);

                    let map: Map<string, IGitBlameLine[]> = new Map();
                    sorted.forEach(l => {
                        let item = map.get(l.sha);
                        if (item) {
                            item.push(l);
                        } else {
                            map.set(l.sha, [l]);
                        }
                    });

                    const commits = Array.from(map.keys());
                    Array.from(map.values()).forEach((lines, i) => {
                        const uri = GitBlameCodeLens.toUri(lens, i + 1, lines[0], lines, commits);
                        lines.forEach(l => locations.push(new Location(uri, new Position(l.originalLine, 0))));
                    });
                } else {
                    locations = [new Location(GitBlameCodeLens.toUri(lens, 1, recentLine, lines, [recentLine.sha]), lens.range.start)];
                }

                lens.command = {
                    title: `${recentLine.author}, ${moment(recentLine.date).fromNow()}`,
                    command: Commands.ShowBlameHistory,
                    arguments: [Uri.file(lens.fileName), lens.range.start, locations]
                };
                resolve(lens);
            });
        });//.catch(ex => Promise.reject(ex)); // TODO: Figure out a better way to stop the codelens from appearing
    }

    _resolveGitHistoryCodeLens(lens: GitHistoryCodeLens, token: CancellationToken): Thenable<CodeLens> {
        // TODO: Play with this more -- get this to open the correct diff to the right place
        lens.command = {
            title: `View History`,
            command: 'git.viewFileHistory', // viewLineHistory
            arguments: [Uri.file(lens.fileName)]
        };
        return Promise.resolve(lens);
    }
}

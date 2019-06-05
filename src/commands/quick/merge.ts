'use strict';
import { Container } from '../../container';
import { GitBranch, Repository } from '../../git/gitService';
import { GlyphChars } from '../../constants';
import { CommandAbortError, QuickPickStep } from './quickCommand';
import { BranchQuickPickItem, RepositoryQuickPickItem } from '../../quickpicks';
import { Strings } from '../../system';
import { GitCommandBase } from './gitCommand';
import { runGitCommandInTerminal } from '../../terminal';

interface State {
    repo: Repository;
    destination: GitBranch;
    source: GitBranch;
}

export class MergeQuickCommand extends GitCommandBase {
    constructor() {
        super('merge', 'Merge');
    }

    execute(state: State) {
        runGitCommandInTerminal('merge', state.source.ref, state.repo.path);
    }

    async *steps(): AsyncIterableIterator<QuickPickStep> {
        const state: Partial<State> & { counter: number } = { counter: 0 };
        let oneRepo = false;

        while (true) {
            try {
                if (state.repo === undefined || state.counter < 1) {
                    const repos = [...(await Container.git.getOrderedRepositories())];

                    if (repos.length === 1) {
                        oneRepo = true;
                        state.counter++;
                        state.repo = repos[0];
                    }
                    else {
                        const active = state.repo ? state.repo : await Container.git.getActiveRepository();

                        const step = this.createStep<RepositoryQuickPickItem>({
                            title: this.title,
                            placeholder: 'Choose a repository',
                            items: await Promise.all(
                                repos.map(r =>
                                    RepositoryQuickPickItem.create(r, r.id === (active && active.id), {
                                        branch: true,
                                        fetched: true,
                                        status: true
                                    })
                                )
                            )
                        });
                        const selection = yield step;

                        if (!this.canMoveNext(step, state, selection)) {
                            break;
                        }

                        state.repo = selection[0].item;
                    }
                }

                state.destination = await state.repo.getBranch();
                if (state.destination === undefined) break;

                if (state.source === undefined || state.counter < 2) {
                    const destId = state.destination.id;

                    const step = this.createStep<BranchQuickPickItem>({
                        title: `${this.title} into ${state.destination.name}${Strings.pad(GlyphChars.Dot, 2, 2)}${
                            state.repo.name
                        }`,
                        placeholder: `Choose a branch or tag to merge into ${state.destination.name}`,
                        items: await this.getBranchesAndOrTags(state.repo, true, {
                            filterBranches: b => b.id !== destId,
                            picked: state.source && state.source.ref
                        })
                    });
                    const selection = yield step;

                    if (!this.canMoveNext(step, state, selection)) {
                        if (oneRepo) {
                            break;
                        }
                        continue;
                    }

                    state.source = selection[0].item;
                }

                // TODO: Add --ff-only, --no-ff, others?
                // TODO: Get commit count

                const step = this.createConfirmStep(
                    `Confirm ${this.title}${Strings.pad(GlyphChars.Dot, 2, 2)}${state.repo.name}`,
                    [
                        {
                            label: this.title,
                            description: `$(git-branch) ${state.source.name} into${Strings.pad('$(git-branch)', 2, 1)}${
                                state.destination.name
                            }`,
                            detail: `Will merge x commits from${Strings.pad('$(git-branch)', 2, 1)}${
                                state.source.name
                            } into${Strings.pad('$(git-branch)', 2, 1)}${state.destination.name}`
                        }
                    ]
                );
                const selection = yield step;

                if (!this.canMoveNext(step, state, selection)) {
                    continue;
                }

                this.execute(state as State);
                break;
            }
            catch (ex) {
                if (ex instanceof CommandAbortError) break;

                throw ex;
            }
        }
    }
}

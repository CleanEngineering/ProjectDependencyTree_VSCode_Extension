const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

let panel;
let currentModel;

function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'projectDependencyTree.open',
            () => openDependencyTree(context)
        ),
        vscode.commands.registerCommand(
            'projectDependencyTree.exportText',
            () => exportText()
        )
    );
}

function deactivate() {
    if (panel) {
        panel.dispose();
        panel = undefined;
    }
}

async function openDependencyTree(context) {
    // The only input requested from the user is the solution file.
    const solutionPath = await pickSolution();

    if (!solutionPath) {
        return;
    }

    try {
        currentModel = buildModel(solutionPath);
    } catch (error) {
        vscode.window.showErrorMessage(
            `Project Dependency Tree: ${error.message}`
        );
        return;
    }

    if (panel) {
        panel.reveal(vscode.ViewColumn.One);
        panel.webview.html = renderHtml(panel.webview, currentModel, context.extensionUri);
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'projectDependencyTree',
        'Project Dependency Tree',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    panel.onDidDispose(() => {
        panel = undefined;
        currentModel = undefined;
    }, null, context.subscriptions);

    panel.webview.onDidReceiveMessage(async message => {
        if (message.type === 'export') {
            await exportText();
        }
    }, null, context.subscriptions);

    panel.webview.html = renderHtml(
        panel.webview,
        currentModel,
        context.extensionUri
    );
}

async function pickSolution() {
    const result = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        filters: {
            'Visual Studio Solution': ['slnx', 'sln']
        },
        title: 'Project Dependency Tree — Select Solution'
    });

    return result && result.length
        ? result[0].fsPath
        : undefined;
}

function buildModel(solutionPath) {
    const solution = canonicalExistingFile(solutionPath);

    if (!solution) {
        throw new Error(
            `Solution file does not exist:\n${solutionPath}`
        );
    }

    const solutionProjects = parseSolutionProjects(solution);

    // Keep every project declared by the solution, even when the project
    // file cannot currently be resolved on disk. This is important for
    // .slnx files: the solution is the source of truth for the project
    // universe, while the project file is only needed to read references.
    const projects = new Map();

    for (const projectPath of solutionProjects) {
        const canonical = canonicalExistingFile(projectPath);
        const resolved = canonical || path.normalize(projectPath);
        const key = normalize(resolved);

        if (!projects.has(key)) {
            projects.set(key, resolved);
        }
    }

    if (projects.size === 0) {
        throw new Error(
            `No existing project files were found in:\n${solution}`
        );
    }

    const dependencies = new Map();

    // Build Project -> ProjectReference relationships
    // for every project in the selected solution.
    for (const projectPath of projects.values()) {
        const key = normalize(projectPath);
        const references = readProjectReferences(projectPath);

        const validReferences = [];

        for (const reference of references) {
            const referencedProject =
                canonicalExistingFile(reference) ||
                path.normalize(reference);

            const referenceKey =
                normalize(referencedProject);

            // Only dependencies belonging to this solution
            // are included. A reference is matched against the complete
            // project set declared by the solution, including projects
            // whose files are temporarily unavailable.
            if (!projects.has(referenceKey)) {
                continue;
            }

            validReferences.push(referenceKey);
        }

        dependencies.set(
            key,
            [...new Set(validReferences)]
        );
    }

    return {
        solutionPath: solution,
        solutionName: path.basename(solution),

        projects: [...projects.values()]
            .map(project => ({
                name: projectName(project),
                path: project
            }))
            .sort((a, b) =>
                a.name.localeCompare(b.name)
            ),

        dependencies: Object.fromEntries(
            [...dependencies.entries()]
        )
    };
}

function parseSolutionProjects(solutionPath) {
    const content = fs.readFileSync(solutionPath, 'utf8');
    const result = [];

    if (/\.slnx$/i.test(solutionPath)) {
        // .slnx is XML and projects can be nested inside any number of
        // <Folder> elements. We intentionally ignore the folder hierarchy
        // and collect every <Project Path="..."> element in the solution.
        const projectTagRegex = /<Project\b([^>]*)>/gi;
        let match;

        while ((match = projectTagRegex.exec(content)) !== null) {
            const attributes = parseXmlAttributes(match[1]);
            const projectValue = attributes.Path;

            if (!projectValue) {
                continue;
            }

            const resolved = resolvePath(
                path.dirname(solutionPath),
                decodeXmlEntities(projectValue)
            );

            result.push(resolved);
        }
    } else {
        // .sln can contain projects of many types, not only C#/F#/VB.
        // Capture every project entry and resolve its relative path.
        const projectRegex =
            /Project\("[^\r\n"]+"\)\s*=\s*"(?:[^"]*)"\s*,\s*"([^"]+)"\s*,\s*"[^"]+"/gi;

        let match;

        while ((match = projectRegex.exec(content)) !== null) {
            const relativeProjectPath = match[1];

            // .sln may contain solution folders as Project entries. They do
            // not point to a project file, so only keep existing files.
            const resolved = resolvePath(
                path.dirname(solutionPath),
                relativeProjectPath
            );

            if (isProjectFilePath(resolved)) {
                result.push(resolved);
            }
        }
    }

    return [...new Set(result)];
}

function parseXmlAttributes(attributeText) {
    const attributes = {};
    const regex = /([:\w.-]+)\s*=\s*(["'])(.*?)\2/g;
    let match;

    while ((match = regex.exec(attributeText)) !== null) {
        attributes[match[1]] = match[3];
    }

    return attributes;
}

function decodeXmlEntities(value) {
    return String(value)
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

function isProjectFilePath(filePath) {
    // Do not restrict this to csproj/fsproj/vbproj. Visual Studio solutions
    // can contain SQL projects and other project systems.
    return /\.[^.\\/]+proj$/i.test(filePath) ||
        /\.proj$/i.test(filePath);
}

function readProjectReferences(projectPath) {
    let content;

    try {
        content =
            fs.readFileSync(projectPath, 'utf8');
    } catch (_) {
        return [];
    }

    const result = [];

    const regex =
        /<ProjectReference\b[^>]*\bInclude\s*=\s*(['"])(.*?)\1[^>]*\/?>/gi;

    let match;

    while ((match = regex.exec(content)) !== null) {
        result.push(
            resolvePath(
                path.dirname(projectPath),
                decodeXmlEntities(match[2])
            )
        );
    }

    return [...new Set(result)];
}

function canonicalExistingFile(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath)) {
            return undefined;
        }

        return fs.realpathSync.native(filePath);
    } catch (_) {
        return undefined;
    }
}

function resolvePath(baseDirectory, value) {
    const cleaned =
        String(value)
            .trim()
            .replace(/^file:\/\/\//i, '');

    return path.normalize(
        path.resolve(baseDirectory, cleaned)
    );
}

function normalize(filePath) {
    return path.normalize(filePath).toLowerCase();
}

function projectName(projectPath) {
    return path.basename(projectPath)
        .replace(/\.([^.\\/]+proj|proj)$/i, '');
}

/*
 * A "root" is a project that is not referenced by another
 * project in the selected solution.
 *
 * Every root is rendered.
 * Dependencies are recursively rendered beneath it.
 *
 * A project is intentionally allowed to appear multiple times
 * when it is reachable through different branches.
 */
function findRootProjects(model) {
    const referenced = new Set();

    for (const references of Object.values(
        model.dependencies
    )) {
        for (const reference of references) {
            referenced.add(reference);
        }
    }

    const roots = model.projects
        .filter(project =>
            !referenced.has(
                normalize(project.path)
            )
        )
        .sort((a, b) =>
            a.name.localeCompare(b.name)
        );

    // A completely cyclic solution has no natural roots.
    // In that case render all projects as roots.
    if (roots.length === 0) {
        return [...model.projects];
    }

    return roots;
}

function createTreeLines(model) {
    const lines = [];

    lines.push('Project Dependency Tree');
    lines.push('=======================');
    lines.push('');
    lines.push(`Solution: ${model.solutionName}`);
    lines.push(
        `Projects: ${model.projects.length}`
    );
    lines.push(
        `Generated: ${new Date().toISOString()}`
    );
    lines.push('');

    const roots = findRootProjects(model);

    const dependencyMap =
        model.dependencies;

    function appendNode(
        key,
        prefix,
        isLast,
        ancestry,
        isRoot
    ) {
        const project =
            model.projects.find(
                p => normalize(p.path) === key
            );

        const name = project
            ? project.name
            : key.split(/[\\/]/).pop();

        if (isRoot) {
            lines.push(name);
        } else {
            lines.push(
                prefix +
                (isLast ? '\\-- ' : '|-- ') +
                name
            );
        }

        if (ancestry.has(key)) {
            lines.push(
                prefix + '    (cycle)'
            );
            return;
        }

        const nextAncestry =
            new Set(ancestry);

        nextAncestry.add(key);

        const children =
            dependencyMap[key] || [];

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const childIsLast =
                i === children.length - 1;

            let childPrefix = prefix;

            if (!isRoot) {
                childPrefix +=
                    isLast ? '    ' : '|   ';
            }

            appendNode(
                child,
                childPrefix,
                childIsLast,
                nextAncestry,
                false
            );
        }
    }

    for (let i = 0; i < roots.length; i++) {
        const root = roots[i];

        appendNode(
            normalize(root.path),
            '',
            i === roots.length - 1,
            new Set(),
            true
        );

        if (i < roots.length - 1) {
            lines.push('');
        }
    }

    return lines;
}

async function exportText() {
    if (!currentModel) {
        vscode.window.showWarningMessage(
            'Open the Project Dependency Tree first.'
        );
        return;
    }

    const defaultName =
        `${path.basename(
            currentModel.solutionPath,
            path.extname(
                currentModel.solutionPath
            )
        )}-dependency-tree.txt`;

    const target =
        await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(
                path.join(
                    path.dirname(
                        currentModel.solutionPath
                    ),
                    defaultName
                )
            ),
            saveLabel: 'Export Dependency Tree',
            filters: {
                'Text File': ['txt']
            }
        });

    if (!target) {
        return;
    }

    try {
        const lines =
            createTreeLines(currentModel);

        fs.writeFileSync(
            target.fsPath,
            lines.join('\r\n') + '\r\n',
            { encoding: 'utf8' }
        );

        vscode.window.showInformationMessage(
            `Dependency tree exported to ${target.fsPath}`
        );
    } catch (error) {
        vscode.window.showErrorMessage(
            `Could not export dependency tree: ${error.message}`
        );
    }
}

function renderHtml(webview, model, extensionUri) {
    const nonce = getNonce();

    const safeModel =
        JSON.stringify(model)
            .replace(/</g, '\\u003c');

    const codiconCssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'codicon.css')
    );

    return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport"
      content="width=device-width, initial-scale=1">

<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               style-src 'unsafe-inline' ${webview.cspSource};
               font-src ${webview.cspSource};
               script-src 'nonce-${nonce}';">

<link rel="stylesheet" href="${codiconCssUri}">

<style>

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    overflow: hidden;
}

.treeHeader {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 78px;
    padding: 14px 28px 12px;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
}

.treeHeaderMain {
    min-width: 0;
}

.treeHeaderInfo {
    margin-top: 3px;
    opacity: .65;
    font-size: .82em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.treeActions {
    display: flex;
    align-items: center;
    gap: 3px;
    flex: 0 0 auto;
}

.iconButton {
    width: 32px;
    height: 30px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-foreground);
    opacity: .75;
    cursor: pointer;
    font-size: 1em;
    line-height: 28px;
    text-align: center;
}

.iconButton .codicon {
    font-size: 18px;
}

.iconButton:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
    border-color: var(--vscode-panel-border);
}

.iconButton:disabled {
    opacity: .28;
    cursor: default;
    background: transparent;
    border-color: transparent;
}

.iconButton:disabled:hover {
    opacity: .28;
    background: transparent;
    border-color: transparent;
}

.filterRow {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 8px;
}

.filterRow .search {
    flex: 1 1 auto;
    min-width: 0;
    margin-bottom: 0;
}

.clearButton {
    width: 26px;
    height: 26px;
    flex: 0 0 26px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-foreground);
    opacity: .7;
    cursor: pointer;
    font-size: 1em;
    line-height: 24px;
}

.clearButton .codicon {
    font-size: 16px;
}

.clearButton:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
    border-color: var(--vscode-panel-border);
}

.layout {
    display: grid;
    grid-template-columns:
        320px minmax(0, 1fr) 360px;

    height: 100vh;
}

.sidebar {
    border-right:
        1px solid var(--vscode-panel-border);
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 8px;
    overflow: hidden;
}

.filterPanel {
    flex: 0 0 auto;
    padding-top: 6px;
    padding-bottom: 2px;
}

.projectsViewport {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding-right: 8px;
}

.search {
    width: 100%;
    margin-bottom: 8px;
    padding: 6px 8px;

    color:
        var(--vscode-input-foreground);

    background:
        var(--vscode-input-background);

    border:
        1px solid
        var(--vscode-input-border);

    outline: none;
}

.project {
    display: block;
    width: max-content;
    min-width: 100%;
    text-align: left;

    padding: 7px 8px;
    margin: 2px 0;

    border: 0;
    background: transparent;

    color:
        var(--vscode-foreground);

    cursor: pointer;
    border-radius: 3px;
}

.project:hover {
    background:
        var(--vscode-list-hoverBackground);
}

.project.selected {
    background:
        var(--vscode-list-activeSelectionBackground);

    color:
        var(--vscode-list-activeSelectionForeground);
}

.project strong {
    font-weight: 700;
}

.project .path {
    display: block;
    opacity: .6;
    font-size: .82em;
    margin-top: 2px;
    padding-right: 20px;

    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
}


.relations {
    border-left:
        1px solid var(--vscode-panel-border);
    overflow: auto;
    padding: 14px;
}

.relationsTitle {
    font-size: 1.05em;
    font-weight: 700;
    margin-bottom: 10px;
}

.relationSection {
    margin-bottom: 20px;
}

.relationSectionTitle {
    font-weight: 700;
    margin-bottom: 7px;
}

.relationList {
    border:
        1px solid var(--vscode-panel-border);
    border-radius: 4px;
    overflow: hidden;
}

.relationItem {
    width: 100%;
    display: block;
    text-align: left;
    border: 0;
    border-bottom:
        1px solid var(--vscode-panel-border);
    padding: 7px 9px;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
}

.relationItem:last-child {
    border-bottom: 0;
}

.relationItem:hover {
    background: var(--vscode-list-hoverBackground);
}

.relationItem .relationName {
    display: block;
    font-weight: 400;
    font-size: .84em;
    line-height: 1.35;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
}

.relationItem.direct .relationName {
    font-weight: 700;
    font-size: .92em;
}

.selectedProjectName {
    display: block;
    font-weight: 700;
    line-height: 1.35;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
}

.selectedProjectPath {
    display: block;
    margin-top: 4px;
    opacity: .6;
    font-size: .8em;
    line-height: 1.35;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
}

.relationEmpty {
    padding: 9px;
    opacity: .65;
}

.relationStats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
    margin-top: 7px;
}

.stat {
    padding: 7px 9px;
    border:
        1px solid var(--vscode-panel-border);
    border-radius: 4px;
}

.statValue {
    font-size: 1.15em;
    font-weight: 700;
}

.statLabel {
    opacity: .65;
    font-size: .78em;
    margin-top: 2px;
}

.diagram {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.treeViewport {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow: auto;
    padding: 12px 28px 24px;
}

.tree {
    min-width: max-content;
    padding-bottom: 60px;
}

.treeTitle {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 1.1em;
    font-weight: 700;
    margin-bottom: 0;
}

.treeTitleIcon {
    font-size: 18px;
    opacity: .9;
}

.rootSection {
    margin-bottom: 18px;
}

.node {
    display: flex;
    align-items: center;
    min-height: 30px;

    white-space: nowrap;
    cursor: pointer;
}

.node::before {
    content: "";

    width: 18px;
    height: 1px;

    background:
        var(
            --vscode-tree-indentGuidesStroke,
            var(--vscode-panel-border)
        );

    margin-right: 5px;
}

.toggle {
    width: 18px;
    min-width: 18px;
    height: 22px;
    margin-right: 2px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--vscode-foreground);
    opacity: .8;
    cursor: pointer;
    font-size: .9em;
    line-height: 22px;
}

.toggle:hover {
    opacity: 1;
    background: var(--vscode-list-hoverBackground);
    border-radius: 3px;
}

.toggle.placeholder {
    cursor: default;
    opacity: 0;
}

.node .name {
    padding: 4px 8px;
    border-radius: 3px;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
}

.node:hover .name {
    background:
        var(--vscode-list-hoverBackground);
}

.node.highlight .name {
    font-weight: 800;

    color:
        var(--vscode-textLink-foreground);

    background:
        var(
            --vscode-editor-findMatchHighlightBackground
        );
}


.node.upstream .name,
.node.upstream .rootNode {
    font-weight: 800;
}
.rootNode {
    font-weight: 400;

    border:
        1px solid
        var(--vscode-focusBorder);

    padding: 5px 9px;
    border-radius: 4px;
}

.children {
    margin-left: 18px;

    border-left:
        1px solid
        var(
            --vscode-tree-indentGuidesStroke,
            var(--vscode-panel-border)
        );

    padding-left: 12px;
}

.cycle .name {
    opacity: .65;
}

.badge {
    opacity: .6;
    font-size: .82em;
    margin-left: 8px;
}

</style>
</head>

<body>

<div class="layout">

    <aside class="sidebar">

        <div class="filterPanel">
            <div class="filterRow">
                <input
                    id="search"
                    class="search"
                    placeholder="Filter projects...">
                <button
                    id="clear"
                    class="clearButton"
                    type="button"
                    title="Clear selection"
                    aria-label="Clear selection">
                    <span class="codicon codicon-clear-all" aria-hidden="true"></span>
                </button>
            </div>
        </div>

        <div class="projectsViewport">
            <div id="projects"></div>
        </div>

    </aside>

    <main class="diagram">

        <div id="treeHeader" class="treeHeader"></div>

        <div class="treeViewport">
            <div
                id="tree"
                class="tree">
            </div>
        </div>

    </main>

    <aside class="relations">
        <div class="relationsTitle">Selected Project Relations</div>
        <div id="relations"></div>
    </aside>

</div>

<script nonce="${nonce}">

const vscode = acquireVsCodeApi();
const model = ${safeModel};

const selected = new Set();
const collapsed = new Set();
let navigationOccurrence = null;

const projectMap = new Map(
    model.projects.map(
        p => [p.path.toLowerCase(), p]
    )
);

const dependencies = new Map(
    Object.entries(model.dependencies)
        .map(([key, value]) => [
            key.toLowerCase(),
            value.map(
                x => x.toLowerCase()
            )
        ])
);

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderProjects() {

    const filter =
        document
            .getElementById('search')
            .value
            .trim()
            .toLowerCase();

    const host =
        document.getElementById('projects');

    host.innerHTML = '';

    for (const project of model.projects) {

        if (
            filter &&
            !project.name
                .toLowerCase()
                .includes(filter) &&
            !project.path
                .toLowerCase()
                .includes(filter)
        ) {
            continue;
        }

        const key =
            project.path.toLowerCase();

        const button =
            document.createElement('button');

        button.className =
            'project' +
            (
                selected.has(key)
                    ? ' selected'
                    : ''
            );

        button.innerHTML =
            '<strong>' +
            escapeHtml(project.name) +
            '</strong>' +
            '<span class="path">' +
            escapeHtml(project.path) +
            '</span>';

        button.onclick = () => {

            selected.clear();
            selected.add(key);
            navigationOccurrence = null;

            renderProjects();
            renderTree();
            renderRelations();
        };

        host.appendChild(button);
    }
}

function findRoots() {

    const referenced = new Set();

    for (
        const references
        of Object.values(model.dependencies)
    ) {
        for (const reference of references) {
            referenced.add(reference);
        }
    }

    const roots =
        model.projects
            .filter(project =>
                !referenced.has(
                    project.path.toLowerCase()
                )
            )
            .sort(
                (a, b) =>
                    a.name.localeCompare(b.name)
            );

    if (roots.length === 0) {
        return [...model.projects];
    }

    return roots;
}

function findDependents(startKey) {

    // dependencies[A] contains the projects A depends on.
    // For highlighting we need the reverse direction: projects
    // that directly or indirectly depend on the selected project.
    const dependents = new Set();
    const queue = [startKey.toLowerCase()];

    while (queue.length) {

        const target = queue.shift();

        for (const [projectKey, references] of dependencies) {

            if (
                dependents.has(projectKey) ||
                projectKey === startKey.toLowerCase()
            ) {
                continue;
            }

            if (references.includes(target)) {
                dependents.add(projectKey);
                queue.push(projectKey);
            }
        }
    }

    // Roots remain eligible for upstream highlighting when the selected
    // project exists somewhere beneath them in the dependency tree.
    return dependents;
}


function getDirectDependents(startKey) {
    const result = new Set();
    const normalizedStart = startKey.toLowerCase();

    for (const [projectKey, references] of dependencies) {
        if (references.includes(normalizedStart)) {
            result.add(projectKey);
        }
    }

    return result;
}

function getAllDependents(startKey) {
    const result = new Set();
    const queue = [startKey.toLowerCase()];

    while (queue.length) {
        const target = queue.shift();

        for (const [projectKey, references] of dependencies) {
            if (projectKey === startKey.toLowerCase() || result.has(projectKey)) {
                continue;
            }

            if (references.includes(target)) {
                result.add(projectKey);
                queue.push(projectKey);
            }
        }
    }

    return result;
}

function getAllDependencies(startKey) {
    const result = new Set();
    const queue = [startKey.toLowerCase()];

    while (queue.length) {
        const current = queue.shift();
        const references = dependencies.get(current) || [];

        for (const reference of references) {
            if (reference === startKey.toLowerCase() || result.has(reference)) {
                continue;
            }

            result.add(reference);
            queue.push(reference);
        }
    }

    return result;
}

function projectForKey(key) {
    return projectMap.get(key.toLowerCase()) || {
        name: key.split(/[\\\\/]/).pop(),
        path: key
    };
}

function createRelationItem(key, isDirect) {
    const project = projectForKey(key);
    const button = document.createElement('button');
    button.className = 'relationItem' + (isDirect ? ' direct' : ' indirect');
    button.innerHTML =
        '<span class="relationName">' +
        escapeHtml(project.name) +
        '</span>';

    button.title = project.path;

    button.onclick = () => {
        selected.clear();
        selected.add(key.toLowerCase());
        navigationOccurrence = null;
        renderProjects();
        renderTree();
        renderRelations();
    };

    return button;
}

function createRelationSection(title, keys, directKeys, directCount, indirectCount) {
    const section = document.createElement('div');
    section.className = 'relationSection';

    const heading = document.createElement('div');
    heading.className = 'relationSectionTitle';
    heading.textContent = title;
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'relationList';

    const directSet = new Set(directKeys);
    const sortedKeys = [...keys].sort((a, b) => {
        const aDirect = directSet.has(a);
        const bDirect = directSet.has(b);

        if (aDirect !== bDirect) {
            return aDirect ? -1 : 1;
        }

        return projectForKey(a).name.localeCompare(projectForKey(b).name);
    });

    if (!sortedKeys.length) {
        const empty = document.createElement('div');
        empty.className = 'relationEmpty';
        empty.textContent = 'None';
        list.appendChild(empty);
    } else {
        for (const key of sortedKeys) {
            list.appendChild(createRelationItem(key, directSet.has(key)));
        }
    }

    section.appendChild(list);

    const stats = document.createElement('div');
    stats.className = 'relationStats';

    const direct = document.createElement('div');
    direct.className = 'stat';
    direct.innerHTML =
        '<div class="statValue">' + directCount + '</div>' +
        '<div class="statLabel">Direct</div>';

    const indirect = document.createElement('div');
    indirect.className = 'stat';
    indirect.innerHTML =
        '<div class="statValue">' + indirectCount + '</div>' +
        '<div class="statLabel">Indirect</div>';

    stats.appendChild(direct);
    stats.appendChild(indirect);
    section.appendChild(stats);

    return section;
}

function renderRelations() {
    const host = document.getElementById('relations');
    host.innerHTML = '';

    if (selected.size !== 1) {
        const empty = document.createElement('div');
        empty.className = 'relationEmpty';
        empty.textContent = 'Select a project to see its relations.';
        host.appendChild(empty);
        return;
    }

    const selectedKey = [...selected][0];
    const directDependents = getDirectDependents(selectedKey);
    const allDependents = getAllDependents(selectedKey);
    const directDependencies = new Set(dependencies.get(selectedKey) || []);
    const allDependencies = getAllDependencies(selectedKey);

    const indirectDependents = new Set(allDependents);
    for (const key of directDependents) {
        indirectDependents.delete(key);
    }

    const indirectDependencies = new Set(allDependencies);
    for (const key of directDependencies) {
        indirectDependencies.delete(key);
    }

    const selectedProject = projectForKey(selectedKey);
    const selectedTitle = document.createElement('div');
    selectedTitle.className = 'relationEmpty';
    selectedTitle.innerHTML =
        '<span class="selectedProjectName">' +
        escapeHtml(selectedProject.name) +
        '</span>' +
        '<span class="selectedProjectPath">' +
        escapeHtml(selectedProject.path) +
        '</span>';
    host.appendChild(selectedTitle);

    host.appendChild(
        createRelationSection(
            'Projects that use this project',
            allDependents,
            directDependents,
            directDependents.size,
            indirectDependents.size
        )
    );

    host.appendChild(
        createRelationSection(
            'Projects this project uses',
            allDependencies,
            directDependencies,
            directDependencies.size,
            indirectDependencies.size
        )
    );
}

function setupTreeHeader() {

    const host = document.getElementById('treeHeader');
    host.innerHTML = '';

    const headerMain = document.createElement('div');
    headerMain.className = 'treeHeaderMain';

    const title = document.createElement('div');
    title.className = 'treeTitle';
    title.innerHTML =
        '<span class="codicon codicon-symbol-class treeTitleIcon" aria-hidden="true"></span>' +
        '<span>Project Dependencies</span>';
    headerMain.appendChild(title);

    const info = document.createElement('div');
    info.className = 'treeHeaderInfo';
    info.textContent = model.solutionName + ' | ' + model.projects.length + ' projects';
    headerMain.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'treeActions';

    const exportButton = document.createElement('button');
    exportButton.className = 'iconButton';
    exportButton.type = 'button';
    exportButton.innerHTML = '<span class="codicon codicon-export" aria-hidden="true"></span>';
    exportButton.title = 'Export TXT';
    exportButton.setAttribute('aria-label', 'Export TXT');
    exportButton.onclick = () => vscode.postMessage({ type: 'export' });

    const expandButton = document.createElement('button');
    expandButton.className = 'iconButton';
    expandButton.type = 'button';
    expandButton.innerHTML = '<span class="codicon codicon-expand-all" aria-hidden="true"></span>';
    expandButton.title = 'Expand All';
    expandButton.setAttribute('aria-label', 'Expand All');
    expandButton.onclick = () => {
        for (const id of getAllExpandableOccurrenceIds()) {
            collapsed.delete(id);
        }
        renderTree();
    };

    const collapseButton = document.createElement('button');
    collapseButton.className = 'iconButton';
    collapseButton.type = 'button';
    collapseButton.innerHTML = '<span class="codicon codicon-collapse-all" aria-hidden="true"></span>';
    collapseButton.title = 'Collapse All';
    collapseButton.setAttribute('aria-label', 'Collapse All');
    collapseButton.onclick = () => {
        for (const id of getAllExpandableOccurrenceIds()) {
            collapsed.add(id);
        }
        renderTree();
    };

    const previousButton = document.createElement('button');
    previousButton.className = 'iconButton navigationButton';
    previousButton.type = 'button';
    previousButton.innerHTML = '<span class="codicon codicon-arrow-up" aria-hidden="true"></span>';
    previousButton.title = 'Previous occurrence';
    previousButton.setAttribute('aria-label', 'Previous occurrence');
    previousButton.onclick = () => navigateOccurrence(-1);

    const nextButton = document.createElement('button');
    nextButton.className = 'iconButton navigationButton';
    nextButton.type = 'button';
    nextButton.innerHTML = '<span class="codicon codicon-arrow-down" aria-hidden="true"></span>';
    nextButton.title = 'Next occurrence';
    nextButton.setAttribute('aria-label', 'Next occurrence');
    nextButton.onclick = () => navigateOccurrence(1);

    actions.appendChild(exportButton);
    actions.appendChild(expandButton);
    actions.appendChild(collapseButton);
    actions.appendChild(previousButton);
    actions.appendChild(nextButton);
    host.appendChild(headerMain);
    host.appendChild(actions);
}

function collectOccurrencesForProject(targetKey) {
    const target = targetKey.toLowerCase();
    const occurrences = [];

    function visit(key, ancestry) {
        const normalized = key.toLowerCase();
        const occurrence = occurrenceId(ancestry, normalized);

        if (normalized === target) {
            occurrences.push(occurrence);
        }

        if (ancestry.has(normalized)) {
            return;
        }

        const nextAncestry = new Set(ancestry);
        nextAncestry.add(normalized);

        for (const child of (dependencies.get(normalized) || [])) {
            visit(child, nextAncestry);
        }
    }

    for (const root of findRoots()) {
        visit(root.path.toLowerCase(), new Set());
    }

    return occurrences;
}

function expandOccurrencePath(occurrence) {
    const parts = occurrence.split('>');

    for (let i = 0; i < parts.length; i++) {
        collapsed.delete(parts.slice(0, i + 1).join('>'));
    }
}

function updateNavigationButtons() {
    const buttons = document.querySelectorAll('.navigationButton');
    if (buttons.length !== 2) {
        return;
    }

    const previousButton = buttons[0];
    const nextButton = buttons[1];
    const hasSelection = selected.size === 1;

    if (!hasSelection) {
        previousButton.disabled = true;
        nextButton.disabled = true;
        return;
    }

    const key = [...selected][0];
    const occurrences = collectOccurrencesForProject(key);

    if (!occurrences.length) {
        previousButton.disabled = true;
        nextButton.disabled = true;
        return;
    }

    let index = navigationOccurrence
        ? occurrences.indexOf(navigationOccurrence)
        : 0;

    if (index < 0) {
        index = 0;
        navigationOccurrence = occurrences[0];
    }

    previousButton.disabled = index <= 0;
    nextButton.disabled = index >= occurrences.length - 1;
}

function navigateOccurrence(direction) {
    if (selected.size !== 1) {
        return;
    }

    const key = [...selected][0];
    const occurrences = collectOccurrencesForProject(key);

    if (!occurrences.length) {
        return;
    }

    let currentIndex = navigationOccurrence
        ? occurrences.indexOf(navigationOccurrence)
        : 0;

    if (currentIndex < 0) {
        currentIndex = 0;
    }

    const targetIndex = currentIndex + direction;

    if (targetIndex < 0 || targetIndex >= occurrences.length) {
        return;
    }

    const targetOccurrence = occurrences[targetIndex];
    navigationOccurrence = targetOccurrence;

    // Make the complete path visible before rendering the target occurrence.
    expandOccurrencePath(targetOccurrence);
    renderTree();

    const targetNode = document.querySelector(
        '[data-occurrence="' + CSS.escape(targetOccurrence) + '"]'
    );

    if (targetNode) {
        targetNode.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
        });
    }
}

function renderTree() {

    const host = document.getElementById('tree');
    host.innerHTML = '';

    const roots = findRoots();

    const selectedKey =
        selected.size === 1
            ? [...selected][0]
            : null;

    const upstreamProjects =
        selectedKey
            ? findDependents(selectedKey)
            : new Set();

    for (const root of roots) {

        const section =
            document.createElement('div');

        section.className =
            'rootSection';

        section.appendChild(
            makeNode(
                root.path.toLowerCase(),
                new Set(),
                true,
                upstreamProjects
            )
        );

        host.appendChild(section);
    }

    updateNavigationButtons();
}

function occurrenceId(ancestry, normalized) {
    return [...ancestry, normalized].join('>');
}

function getAllExpandableOccurrenceIds() {
    const result = new Set();

    function visit(key, ancestry) {
        const normalized = key.toLowerCase();
        if (ancestry.has(normalized)) {
            return;
        }

        const children = dependencies.get(normalized) || [];
        if (!children.length) {
            return;
        }

        result.add(occurrenceId(ancestry, normalized));

        const nextAncestry = new Set(ancestry);
        nextAncestry.add(normalized);

        for (const child of children) {
            visit(child, nextAncestry);
        }
    }

    for (const root of findRoots()) {
        visit(root.path.toLowerCase(), new Set());
    }

    return result;
}

function makeNode(
    key,
    ancestry,
    isRoot,
    upstreamProjects
) {
    const normalized = key.toLowerCase();
    const occurrence = occurrenceId(ancestry, normalized);

    const wrap = document.createElement('div');
    const node = document.createElement('div');
    node.className = 'node';
    node.dataset.occurrence = occurrence;
    node.dataset.projectKey = normalized;

    if (selected.has(normalized)) {
        node.classList.add('highlight');
    } else if (upstreamProjects.has(normalized)) {
        node.classList.add('upstream');
    }

    const project = projectMap.get(normalized);
    const name = document.createElement('span');
    name.className = isRoot ? 'rootNode' : 'name';
    name.textContent = project ? project.name : normalized.split(/[\\/]/).pop();

    const children = dependencies.get(normalized) || [];
    const hasChildren = children.length > 0 && !ancestry.has(normalized);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = hasChildren ? 'toggle' : 'toggle placeholder';
    toggle.setAttribute('aria-label', hasChildren
        ? (collapsed.has(occurrence) ? 'Expand' : 'Collapse')
        : 'No children');
    toggle.textContent = hasChildren
        ? (collapsed.has(occurrence) ? '▶' : '▼')
        : '•';

    toggle.onclick = event => {
        event.stopPropagation();
        if (!hasChildren) {
            return;
        }
        if (collapsed.has(occurrence)) {
            collapsed.delete(occurrence);
        } else {
            collapsed.add(occurrence);
        }
        renderTree();
    };

    node.appendChild(toggle);
    node.appendChild(name);

    node.onclick = event => {
        event.stopPropagation();
        selected.clear();
        selected.add(normalized);
        navigationOccurrence = occurrence;
        renderProjects();
        renderTree();
        renderRelations();
    };

    wrap.appendChild(node);

    if (ancestry.has(normalized)) {
        node.classList.add('cycle');
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '(cycle)';
        name.appendChild(badge);
        return wrap;
    }

    if (!children.length || collapsed.has(occurrence)) {
        return wrap;
    }

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(normalized);

    const childContainer = document.createElement('div');
    childContainer.className = 'children';

    for (const child of children) {
        childContainer.appendChild(
            makeNode(child, nextAncestry, false, upstreamProjects)
        );
    }

    wrap.appendChild(childContainer);
    return wrap;
}

document
    .getElementById('clear')
    .onclick = () => {

        selected.clear();
        navigationOccurrence = null;

        renderProjects();
        renderTree();
        renderRelations();
    };

document
    .getElementById('search')
    .oninput =
        renderProjects;

setupTreeHeader();
renderProjects();
renderTree();
renderRelations();

</script>

</body>
</html>`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getNonce() {
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    let result = '';

    for (let i = 0; i < 32; i++) {
        result += chars.charAt(
            Math.floor(
                Math.random() * chars.length
            )
        );
    }

    return result;
}

module.exports = {
    activate,
    deactivate
};

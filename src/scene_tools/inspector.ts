import * as vscode from "vscode";
import {
    type ExtensionContext,
} from "vscode";
import type { SceneNode, Scene } from "./types";

export class InspectorViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'inspectorView';
    #view?: vscode.WebviewView;

    constructor(private context: ExtensionContext) {
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(InspectorViewProvider.viewType, this)
        );
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken,
    ) {
        this.#view = webviewView;
        this.#view.webview.options = {
            enableScripts: true,
        };
        
        // this.updateView();
    }

    public updateView(node?: SceneNode) {
        const items = node.properties.map((item) => {
            return {
                name: item.name,
                value: item.value,
            };
        });

        this.#view.webview.html = this.#getHtmlForWebview(items);
    }

    #getHtmlForWebview(items?: { name: string; value: any }[]) {
        const tableRows = items.map((item) => {
            return `
			<tr>
				<td>${item.name}</td>
				<td>${item.value}</td>
			</tr>
			`
        }).join("");

        return `<!DOCTYPE html>
		<html>
			<body>
				<table>
					<thead>
						<tr><th>Property</th><th>Value</th></tr>
					</thead>
					<tbody>
						${tableRows}
					</tbody>
				</table>
			</body>
		</html>`;
    }
}
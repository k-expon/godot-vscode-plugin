import { TextDocument, Uri, MarkdownString } from "vscode";
import { basename } from "path";
import * as fs from "fs";
import { SceneNode, Scene, Tag, Parser, NodeProperty } from "./types";
import { TokenType } from "../utils/tokenizer";
import { createLogger } from "../utils";

const log = createLogger("scenes.parser");

export class SceneParser {
	private static instance: SceneParser;
	public scenes: Map<string, Scene> = new Map();

	constructor() {
		if (SceneParser.instance) {
			// biome-ignore lint/correctness/noConstructorReturn: <explanation>
			return SceneParser.instance;
		}
		SceneParser.instance = this;
	}

	public parse_scene(document: TextDocument) {
		const path = document.uri.fsPath;
		const stats = fs.statSync(path);

		if (this.scenes.has(path)) {
			const scene = this.scenes.get(path);

			if (scene.mtime === stats.mtimeMs) {
				return scene;
			}
		}

		const scene = new Scene();
		scene.path = path;
		scene.mtime = stats.mtimeMs;
		scene.title = basename(path);

		this.scenes.set(path, scene);

		const text = document.getText();
		return Parser.input(text).parse<Scene>(parseScene, scene);
	}
}

const parseScene = function (this: Parser, scene: Scene): Scene {

	for (let token, count = 0; (token = this.lexer.peek()).type !== TokenType.EOF; count++) {
		if (token.column !== 1 || token.type !== TokenType.BRACKET_OPEN) {
			this.lexer.token();
			continue;
		}

		const tag = this.parse<Tag>(parseTag);

		if (tag.name === "ext_resource") {
			scene.externalResources[tag.getField("id")] = {
				body: tag.text,
				path: tag.getField("path"),
				type: tag.getField("type"),
				uid: tag.getField("uid"),
				id: tag.getField("id"),
				line: tag.line,
			};
		} else if (tag.name === "sub_resource") {
			let text = [tag.text];
			const properties: NodeProperty[] = [];
			while (this.lexer.peek().type === TokenType.IDENTIFIER) {
				const property = this.parseProperty();
				text.push(property.text);
				properties.push(property);
			}
			scene.subResources[tag.getField("id")] = {
				body: text.join("\n"),
				path: tag.getField("path"),
				type: tag.getField("type"),
				uid: tag.getField("uid"),
				id: tag.getField("id"),
				line: tag.line,
				properties: properties,
			};
		} else if (tag.name === "node") {
			let text = [tag.text];
			const properties: NodeProperty[] = [];
			while (this.lexer.peek().type === TokenType.IDENTIFIER) {
				const property = this.parseProperty();
				text.push(property.text);
				properties.push(property);
			}
			
			const name = tag.getField("name");
			const type = tag.getField("type") ?? "PackedScene";

			let parent = tag.getField("parent");
			let path = {
				absolute: name,
				relative: name
			};

			if (parent) {
				if (parent === ".") {
					parent = scene.root.path;
					path.relative = name;
					path.absolute = `${parent}/${name}`;
				} else {
					path.relative = `${parent}/${name}`;
					parent = `${scene.root.path}/${parent}`;
					path.absolute = `${parent}/${name}`;
				}
			}

			const node = new SceneNode(name, type);
			node.description = type;
			node.path = path.absolute;
			node.relativePath = path.relative;
			node.parent = parent;
			node.text = tag.text;
			node.body = text.join("\n");
			node.position = tag.pos;
			node.resourceUri = Uri.from({
				scheme: "godot",
				path: path.absolute,
			});
			node.properties = properties;
			node.unique = properties.find(p => p.name === "unique_name_in_owner")?.value ?? false;

			const instance = tag.getField("instance");
			if (instance?.length > 0) {
				const id = instance[0];
				node.tooltip = scene.externalResources[id].path;
				node.resourcePath = scene.externalResources[id].path;
				if (node.resourcePath?.includes(".tscn")) {
					node.contextValue += "openable";
				}
				node.contextValue += "hasResourcePath";
			}

			const script = properties.find(p => p.name === "script");
			if (script) {
				node.hasScript = true;
				node.scriptId = script.value[0];
				node.contextValue += "hasScript";
			}

			
			if (parent === undefined) {
				scene.root = node;
			} else if (parent) {
				scene.nodes.get(parent)?.children.push(node);
			}

			scene.nodes.set(path.absolute, node);

			const content = new MarkdownString();
			content.appendCodeblock(node.body, "gdresource");
			node.tooltip = content;
		}
	}
	return scene;
}

const parseTag = function (this: Parser): Tag {

	const token = this.lexer.consume(TokenType.BRACKET_OPEN);

	let tagName = this.lexer.consume(TokenType.IDENTIFIER).value;

	if (this.lexer.peek().type === TokenType.COLON || this.lexer.peek().type === TokenType.PERIOD) {
		const type = this.lexer.token();
		const value = this.lexer.consume(TokenType.IDENTIFIER).value;
		tagName += type.value + value;
	}

	const tag = new Tag(tagName);
	tag.line = token.line;
	tag.pos = token.pos;

	const texts = [tagName];
	while (this.lexer.peek().type !== TokenType.BRACKET_CLOSE && this.lexer.peek().type !== TokenType.EOF) {
		const field = this.parseProperty();
		tag.addField(field.name, field.value);
		texts.push(field.text);
	}
	this.lexer.consume(TokenType.BRACKET_CLOSE);

	const text = texts.join(' ');
	tag.text = `[${text}]`;

	return tag;
}
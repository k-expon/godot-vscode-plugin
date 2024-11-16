import {
	TreeItem,
	TreeItemCollapsibleState,
	MarkdownString,
} from "vscode";
import * as path from "path";
import { get_extension_uri } from "../utils";
import Tokenizr, { Token, TokenType } from "../utils/tokenizer";

const iconDir = get_extension_uri("resources", "godot_icons").fsPath;

export class SceneNode extends TreeItem {
	public path: string;
	public relativePath: string;
	public resourcePath: string;
	public parent: string;
	public text: string;
	public position: number;
	public body: string;
	public unique: boolean = false;
	public hasScript: boolean = false;
	public scriptId: string = "";
	public children: SceneNode[] = [];
	public properties?: NodeProperty[];

	constructor(
		public label: string,
		public className: string,
		public collapsibleState?: TreeItemCollapsibleState
	) {
		super(label, collapsibleState);

		const iconName = className + ".svg";

		this.iconPath = {
			light: path.join(iconDir, "light", iconName),
			dark: path.join(iconDir, "dark", iconName),
		};
	}

	public parse_body() {
		const lines = this.body.split("\n");
		const newLines = [];
		for (let i = 0; i < lines.length; i++) {
			let line = lines[i];
			if (line.startsWith("tile_data")) {
				line = "tile_data = PoolIntArray(...)";
			}
			if (line.startsWith("unique_name_in_owner = true")) {
				this.unique = true;
			}
			if (line.startsWith("script = ExtResource")) {
				this.hasScript = true;
				this.scriptId = line.match(/script = ExtResource\(\s*"?([\w]+)"?\s*\)/)[1];
				this.contextValue += "hasScript";
			}
			if (line != "") {
				newLines.push(line);
			}
		}
		this.body = newLines.join("\n");
		const content = new MarkdownString();
		content.appendCodeblock(this.body, "gdresource");
		this.tooltip = content;
	}
}

export interface GDResource {
	path: string;
	type: string;
	id: string;
	uid: string;
	body?: string;
	index?: number;
	line: number;
	properties?: NodeProperty[];
}

export class Scene {
	public path: string;
	public title: string;
	public mtime: number;
	public root: SceneNode | undefined;
	public externalResources: { [key: string]: GDResource } = {};
	public subResources: { [key: string]: GDResource } = {};
	public nodes: Map<string, SceneNode> = new Map();
	scene: any;
}

export class NodeProperty {
	type: string;
	name?: string;
	value: any;
	text: string;
	line: number;

	constructor(type: string, name: string, value: any, text: string, line: number) {
		this.type = type;
		this.name = name;
		this.value = value;
		this.text = text;
		this.line = line;
	}
}

export class Tag {
	line: number;
	pos: number;
	text: string;

	#name: string;
	public get name(): string {
		return this.#name;
	}
	#fields: { [key: string]: any } = {}

	constructor(name: string) {
		this.#name = name;
	}

	addField(key: string, value: any): void {
		this.#fields[key] = value;
	}

	getField<T extends string = string>(key: T): any {
		return this.#fields[key];
	}

	getFields(): { [key: string]: any } {
		return this.#fields;
	}

	hasField(key: string): boolean {
		return key in this.#fields;
	}
}

export class Parser {
	static #instance: Parser;
	lexer: Tokenizr;

	private constructor() {

		// NOTE: This code migrated `VariantParser::get_token()` from https://github.com/godotengine/godot/blob/master/core/variant/variant_parser.cpp to `Tokenizr`.
		// The order of rules affects performance and priority processing.
		// So, if you want to make changes, be sure to conduct adequate testing.
		this.lexer = new Tokenizr()
			.rule(/[ \t\r\n]+/, (ctx) => {
				ctx.ignore();
			})
			.rule(/;.*/, (ctx) => {
				ctx.ignore();
			})
			.rule(/\(([^)]+)\)/, (ctx, match) => {
				const result = match[1];
				const values = result.split(',').map(value => {
					value = value.trim();
					if (value.startsWith('"') && value.endsWith('"')) {
						return value.slice(1, -1);
					} else {
						return Number(value);
					}
				});
				ctx.accept(TokenType.ARRAY, values);
			})
			.rule(/[{}[\]()]/, (ctx, match) => {
				const types = {
					'{': TokenType.CURLY_BRACKET_OPEN,
					'}': TokenType.CURLY_BRACKET_CLOSE,
					'[': TokenType.BRACKET_OPEN,
					']': TokenType.BRACKET_CLOSE,
					'(': TokenType.PARENTHESIS_OPEN,
					')': TokenType.PARENTHESIS_CLOSE
				};
				ctx.accept(types[match[0]]);
			})
			.rule(/[:,=.]/, (ctx, match) => {
				const types = {
					':': TokenType.COLON,
					',': TokenType.COMMA,
					'.': TokenType.PERIOD,
					'=': TokenType.EQUAL
				}
				ctx.accept(types[match[0]]);
			})
			.rule(/#[0-9a-fA-F]+/, (ctx, match) => {
				ctx.accept(TokenType.COLOR);
			})
			.rule(/"((?:\\.|[^"\\])*)"|&"((?:\\.|[^"\\])*)"/, (ctx, match) => {
				let value = (match[1] || match[2] || '').replace(/\\(.)/g, (_, char) => {
					const escapes = { 'b': '\b', 't': '\t', 'n': '\n', 'f': '\f', 'r': '\r' }
					return escapes[char] || char
				});
				ctx.accept(match[0].startsWith('&') ? TokenType.STRING_NAME : TokenType.STRING, value);
			})
			.rule(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/, (ctx, match) => {
				ctx.accept(TokenType.NUMBER, parseFloat(match[0]));
			})
			.rule(/[a-zA-Z_][a-zA-Z0-9_\/]*/, (ctx, match) => {
				let value: string | boolean = match[0];
				if (value === 'true') {
					value = true;
				} else if (value === 'false') {
					value = false;
				}
				ctx.accept(TokenType.IDENTIFIER, value);
			})
			.rule(/./, (ctx, match) => {
				ctx.accept(TokenType.ERROR, `Unexpected character: ${match[0]}`);
			})
		// .debug(true)
	}

	public static get instance(): Parser {
		if (!Parser.#instance) {
			Parser.#instance = new Parser();
		}

		return Parser.#instance;
	}

	public static input(input: string): Parser {
		const instance = Parser.instance;
		instance.lexer.input(input);
		return instance;
	}

	public parse<T>(callback: (...args: any) => T, ...args): T {
		return callback.apply(this, args);
	}

	parsePrimitive(): Token {
		return this.lexer.alternatives(
			this.lexer.consume.bind(this.lexer, TokenType.NUMBER),
			this.lexer.consume.bind(this.lexer, TokenType.STRING),
			this.lexer.consume.bind(this.lexer, TokenType.STRING_NAME),
			this.lexer.consume.bind(this.lexer, TokenType.COLOR),
			this.lexer.consume.bind(this.lexer, TokenType.IDENTIFIER),
		);
	}

	praseValue(): NodeProperty {
		return this.lexer.alternatives(
			this.parseConstruct.bind(this),
			this.parsePrimitive.bind(this),
			this.parseArray.bind(this),
			this.parseDictionary.bind(this)
		);
	}

	parseProperty(): NodeProperty {
		const token = this.lexer.consume(TokenType.IDENTIFIER) as Token;

		this.lexer.consume(TokenType.EQUAL);

		const value = this.praseValue();

		return {
			type: value.type,
			name: token.value,
			value: value.value,
			text: `${token.text}=${value.text}`,
			line: token.line
		}
	}

	parseConstruct(): NodeProperty {
		const token = this.lexer.consume(TokenType.IDENTIFIER);
		const array = this.lexer.consume(TokenType.ARRAY);

		return {
			type: token.value ?? 'CONSTRUCT',
			name: token.value,
			value: array.value,
			text: `${token.text}${array.text}`,
			line: token.line
		};
	}

	parseArray(): NodeProperty {
		const array = [];
		const token = this.lexer.consume(TokenType.BRACKET_OPEN);
		for (let t; (t = this.lexer.peek()).type !== TokenType.BRACKET_CLOSE;) {
			if (t.type === TokenType.COMMA) {
				this.lexer.token();
				continue;
			}

			const value = this.praseValue();
			array.push(value);
		}
		this.lexer.consume(TokenType.BRACKET_CLOSE);

		const text = array.map((v => v.text)).join(', ');
		return {
			type: 'ARRAY',
			value: array,
			text: `[${text}]`,
			line: token.line
		}
	}

	parseDictionary(): NodeProperty {
		const dictionary = new Map();
		const token = this.lexer.consume(TokenType.CURLY_BRACKET_OPEN);
		for (let t; (t = this.lexer.peek()).type !== TokenType.CURLY_BRACKET_CLOSE;) {
			if (t.type === TokenType.COMMA) {
				this.lexer.token();
				continue;
			}

			const key = this.parsePrimitive();
			this.lexer.consume(TokenType.COLON);

			const value = this.praseValue();
			dictionary.set(key.value, value);
		}
		this.lexer.consume(TokenType.CURLY_BRACKET_CLOSE);

		const text = Array.from(dictionary).map(value => `"${value[0]}"`).join(',');
		return {
			type: 'DICTIONARY',
			value: dictionary,
			text: `{${text}}`,
			line: token.line
		};
	}


}

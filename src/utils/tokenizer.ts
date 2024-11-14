// @ts-nocheck
import Tokenizr, { Token } from "tokenizr";
export { Token } from "tokenizr";

const excerpt = (txt, o) => {
    const l = txt.length
    let b = o - 20; if (b < 0) b = 0
    let e = o + 20; if (e > l) e = l
    const hex = (ch) =>
        ch.charCodeAt(0).toString(16).toUpperCase()
    const extract = (txt, pos, len) =>
        txt.substr(pos, len)
            .replace(/\\/g, "\\\\")
            .replace(/\x08/g, "\\b")
            .replace(/\t/g, "\\t")
            .replace(/\n/g, "\\n")
            .replace(/\f/g, "\\f")
            .replace(/\r/g, "\\r")
            .replace(/[\x00-\x07\x0B\x0E\x0F]/g, (ch) => "\\x0" + hex(ch))
            .replace(/[\x10-\x1F\x80-\xFF]/g, (ch) => "\\x" + hex(ch))
            .replace(/[\u0100-\u0FFF]/g, (ch) => "\\u0" + hex(ch))
            .replace(/[\u1000-\uFFFF]/g, (ch) => "\\u" + hex(ch))
    return {
        prologTrunc: b > 0,
        prologText: extract(txt, b, o - b),
        tokenText: extract(txt, o, 1),
        epilogText: extract(txt, o + 1, e - (o + 1)),
        epilogTrunc: e < l
    }
}

export enum TokenType {
	/** Opening curly bracket '{' */
	CURLY_BRACKET_OPEN = 'CURLY_BRACKET_OPEN',
	/** Closing curly bracket '}' */
	CURLY_BRACKET_CLOSE = 'CURLY_BRACKET_CLOSE',
	/** Opening square bracket '[' */
	BRACKET_OPEN = 'BRACKET_OPEN',
	/** Closing square bracket ']' */
	BRACKET_CLOSE = 'BRACKET_CLOSE',
	/** Opening parenthesis '(' */
	PARENTHESIS_OPEN = 'PARENTHESIS_OPEN',
	/** Closing parenthesis ')' */
	PARENTHESIS_CLOSE = 'PARENTHESIS_CLOSE',
	/** Colon ':' */
	COLON = 'COLON',
	/** Comma ',' */
	COMMA = 'COMMA',
	/** Period '.' */
	PERIOD = 'PERIOD',
	/** Equal sign '=' */
	EQUAL = 'EQUAL',
	/** Color value */
	COLOR = 'COLOR',
	/** String enclosed in double quotes used as name or identifier */
	STRING_NAME = 'STRING_NAME',
	/** String value */
	STRING = 'STRING',
	/** Numeric value */
	NUMBER = 'NUMBER',
	/** Identifier (variable, function name, etc.) */
	IDENTIFIER = 'IDENTIFIER',
    ARRAY = 'ARRAY',
	/** Error token */
	ERROR = 'ERROR',
	/** End of file */
	EOF = 'EOF'
}

export default class extends Tokenizr {

    private finish() {
        if (!this._eof) {
            if (this._finish !== null) this._finish.call(this._ctx, this._ctx);
            this._eof = true;
            this._pending.push(new Token("EOF", "", "", this._pos, this._line, this._column));
        }
    }

    _tokenize() {
        if (this._stopped || this._pos >= this._len) {
            this.finish();
            return;
        }

        const currentState = this._state[this._state.length - 1];
        const tags = Object.keys(this._tag);
        let lineStartPos = 0;


        if (this._debug) this._logDebugInfo(currentState, tags);

        for (let i = 0, count = this._rules.length; i < count; i++) {
            const rule = this._rules[i];
            if (this._debug) this._logRuleDebugInfo(rule);
            if (!this._matchesStateAndTags(rule, currentState, tags)) continue;

            const found = this._matchPattern(rule.pattern);
            if (found === null) continue;

            if (this._debug) this._log("    MATCHED: " + JSON.stringify(found));

            if (this._processRule(rule, found)) return;
        }

        throw this.error("token not recognized");
    }

    _matchesStateAndTags(rule, currentState, tags) {
        const stateIdx = rule.state.findIndex(item => item.state === '*' || item.state === currentState);
        if (stateIdx === -1) return false;
        return rule.state[stateIdx].tags.every(tag => this._tag[tag]);
    }

    _matchPattern(pattern) {
        pattern.lastIndex = this._pos;
        const found = pattern.exec(this._input);
        return (found !== null && found.index === this._pos) ? found : null;
    }

    _processRule(rule, found) {
        this._ctx._match = found;
        this._ctx._repeat = this._ctx._reject = this._ctx._ignore = false;

        if (this._before) this._before.call(this._ctx, this._ctx, found, rule);
        rule.action.call(this._ctx, this._ctx, found);
        if (this._after) this._after.call(this._ctx, this._ctx, found, rule);

        if (this._ctx._reject) return false;
        if (this._ctx._repeat) return false;
        if (this._ctx._ignore) {
            this._progress(this._pos, rule.pattern.lastIndex);
            this._pos = rule.pattern.lastIndex;
            return this._pos >= this._len;
        }
        if (this._pending.length > 0) {
            this._progress(this._pos, rule.pattern.lastIndex);
            this._pos = rule.pattern.lastIndex;
            if (this._pos >= this._len) this.finish();
            return true;
        }

        throw new Error(`action of pattern "${rule.pattern.source}" neither rejected nor accepted any token(s)`);
    }

    _logDebugInfo(currentState, tags) {
        const e = excerpt(this._input, this._pos);
        const tagString = tags.map(tag => `#${tag}`).join(" ");
        this._log(`INPUT: state: <${currentState}>, tags: <${tagString}>, text: ` +
            (e.prologTrunc ? "..." : "\"") + `${e.prologText}<${e.tokenText}>${e.epilogText}` +
            (e.epilogTrunc ? "..." : "\"") + `, at: <line ${this._line}, column ${this._column}>`);
    }

    _logRuleDebugInfo(rule) {
        const state = rule.state.map(item => {
            let output = item.state;
            if (item.tags.length > 0)
                output += " " + item.tags.map(tag => `#${tag}`).join(" ");
            return output;
        }).join(", ");
        this._log(`  RULE: state(s): <${state}>, pattern: ${rule.pattern.source}`);
    }
}
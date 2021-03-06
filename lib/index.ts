let regExpEscapeChars = ["!", "$", "(", ")", "*", "+", ".", "=", "?", "[", "\\", "^", "{", "|"];
let rangeEscapeChars = ["-", "\\", "]"];

export interface GlobToRegExpOptions {
	extended?: boolean,
	globstar?: boolean,
	os?: "linux" | "windows",
}

/**
 * Convert a glob string to a regular expression.
 *
 * Tries to match bash glob expansion as closely as possible.
 *
 * Basic glob syntax:
 * - `*` - Matches everything without leaving the path segment.
 * - `{foo,bar}` - Matches `foo` or `bar`.
 * - `[abcd]` - Matches `a`, `b`, `c` or `d`.
 * - `[a-d]` - Matches `a`, `b`, `c` or `d`.
 * - `[!abcd]` - Matches any single character besides `a`, `b`, `c` or `d`.
 * - `[[:<class>:]]` - Matches any character belonging to `<class>`.
 *     - `[[:alnum:]]` - Matches any digit or letter.
 *     - `[[:digit:]abc]` - Matches any digit, `a`, `b` or `c`.
 *     - See https://facelessuser.github.io/wcmatch/glob/#posix-character-classes
 *       for a complete list of supported character classes.
 * - `\` - Escapes the next character for an `os` other than `"windows"`.
 * - \` - Escapes the next character for `os` set to `"windows"`.
 * - `/` - Path separator.
 * - `\` - Additional path separator only for `os` set to `"windows"`.
 *
 * Extended syntax:
 * - Requires `{ extended: true }`.
 * - `?(foo|bar)` - Matches 0 or 1 instance of `{foo,bar}`.
 * - `@(foo|bar)` - Matches 1 instance of `{foo,bar}`. They behave the same.
 * - `*(foo|bar)` - Matches _n_ instances of `{foo,bar}`.
 * - `+(foo|bar)` - Matches _n > 0_ instances of `{foo,bar}`.
 * - `!(foo|bar)` - Matches anything other than `{foo,bar}`.
 * - See https://www.linuxjournal.com/content/bash-extended-globbing.
 *
 * Globstar syntax:
 * - Requires `{ globstar: true }`.
 * - `**` - Matches any number of any path segments.
 *     - Must comprise its entire path segment in the provided glob.
 * - See https://www.linuxjournal.com/content/globstar-new-bash-globbing-option.
 *
 * Note the following properties:
 * - The generated `RegExp` is anchored at both start and end.
 * - Repeating and trailing separators are tolerated. Trailing separators in the
 *   provided glob have no meaning and are discarded.
 * - Absolute globs will only match absolute paths, etc.
 * - Empty globs will match nothing.
 * - Any special glob syntax must be contained to one path segment. For example,
 *   `?(foo|bar/baz)` is invalid. The separator will take precendence and the
 *   first segment ends with an unclosed group.
 * - If a path segment ends with unclosed groups or a dangling escape prefix, a
 *   parse error has occured. Every character for that segment is taken
 *   literally in this event.
 *
 * Limitations:
 * - A negative group like `!(foo|bar)` will wrongly be converted to a negative
 *   look-ahead followed by a wildcard. This means that `!(foo).js` will wrongly
 *   fail to match `foobar.js`, even though `foobar` is not `foo`. Effectively,
 *   `!(foo|bar)` is treated like `!(@(foo|bar)*)`. This will work correctly if
 *   the group occurs not nested at the end of the segment.
 */
export function globToRegExp (glob: string, opts: GlobToRegExpOptions = {}) {
	if (glob == "") {
		return /(?!)/;
	}

	let {
		extended = true,
		globstar: globstarOption = true,
		os = "linux",
	} = opts;

  let sep = os == "windows" ? "(?:\\\\|/)+" : "/+";
  let sepMaybe = os == "windows" ? "(?:\\\\|/)*" : "/*";
  let seps = os == "windows" ? ["\\", "/"] : ["/"];
  let globstar = os == "windows"
    ? "(?:[^\\\\/]*(?:\\\\|/|$)+)*"
    : "(?:[^/]*(?:/|$)+)*";
  let wildcard = os == "windows" ? "[^\\\\/]*" : "[^/]*";
  let escapePrefix = os == "windows" ? "`" : "\\";

	// Remove trailing separators.
	let newLength = glob.length;
	for (; newLength > 1 && seps.includes(glob[newLength - 1]); newLength--);
	glob = glob.slice(0, newLength);

	let regExpString = "";

	// Terminates correctly. Trust that `j` is incremented every iteration.
	for (let j = 0; j < glob.length;) {
		let segment = "";
		let groupStack = [];
		let inRange = false;
		let inEscape = false;
		let endsWithSep = false;
		let i = j;

		// Terminates with `i` at the non-inclusive end of the current segment.
		for (; i < glob.length && !seps.includes(glob[i]); i++) {
			if (inEscape) {
				inEscape = false;
				let escapeChars = inRange ? rangeEscapeChars : regExpEscapeChars;
				segment += escapeChars.includes(glob[i]) ? `\\${glob[i]}` : glob[i];
				continue;
			}

			if (glob[i] == escapePrefix) {
				inEscape = true;
				continue;
			}

			if (glob[i] == "[") {
				if (!inRange) {
					inRange = true;
					segment += "[";
					if (glob[i + 1] == "!") {
						i++;
						segment += "^";
					} else if (glob[i + 1] == "^") {
						i++;
						segment += "\\^";
					}
					continue;
				} else if (glob[i + 1] == ":") {
					let k = i + 1;
					let value = "";
					while (glob[k + 1] != null && glob[k + 1] != ":") {
						value += glob[k + 1];
						k++;
					}
					if (glob[k + 1] == ":" && glob[k + 2] == "]") {
						i = k + 2;
						if (value == "alnum") segment += "\\dA-Za-z";
						else if (value == "alpha") segment += "A-Za-z";
						else if (value == "ascii") segment += "\x00-\x7F";
						else if (value == "blank") segment += "\t ";
						else if (value == "cntrl") segment += "\x00-\x1F\x7F";
						else if (value == "digit") segment += "\\d";
						else if (value == "graph") segment += "\x21-\x7E";
						else if (value == "lower") segment += "a-z";
						else if (value == "print") segment += "\x20-\x7E";
						else if (value == "punct") {
							segment += "!\"#$%&'()*+,\\-./:;<=>?@[\\\\\\]^_‘{|}~";
						} else if (value == "space") segment += "\\s\v";
						else if (value == "upper") segment += "A-Z";
						else if (value == "word") segment += "\\w";
						else if (value == "xdigit") segment += "\\dA-Fa-f";
						continue;
					}
				}
			}

			if (glob[i] == "]" && inRange) {
				inRange = false;
				segment += "]";
				continue;
			}

			if (inRange) {
				if (glob[i] == "\\") {
					segment += `\\\\`;
				} else {
					segment += glob[i];
				}
				continue;
			}

			if (
				glob[i] == ")" && groupStack.length > 0 &&
				groupStack[groupStack.length - 1] != "BRACE"
			) {
				segment += ")";
				let type = groupStack.pop()!;
				if (type == "!") {
					segment += wildcard;
				} else if (type != "@") {
					segment += type;
				}
				continue;
			}

			if (
				glob[i] == "|" && groupStack.length > 0 &&
				groupStack[groupStack.length - 1] != "BRACE"
			) {
				segment += "|";
				continue;
			}

			if (glob[i] == "+" && extended && glob[i + 1] == "(") {
				i++;
				groupStack.push("+");
				segment += "(?:";
				continue;
			}

			if (glob[i] == "@" && extended && glob[i + 1] == "(") {
				i++;
				groupStack.push("@");
				segment += "(?:";
				continue;
			}

			if (glob[i] == "?") {
				if (extended && glob[i + 1] == "(") {
					i++;
					groupStack.push("?");
					segment += "(?:";
				} else {
					segment += ".";
				}
				continue;
			}

			if (glob[i] == "!" && extended && glob[i + 1] == "(") {
				i++;
				groupStack.push("!");
				segment += "(?!";
				continue;
			}

			if (glob[i] == "{") {
				groupStack.push("BRACE");
				segment += "(?:";
				continue;
			}

			if (glob[i] == "}" && groupStack[groupStack.length - 1] == "BRACE") {
				groupStack.pop();
				segment += ")";
				continue;
			}

			if (glob[i] == "," && groupStack[groupStack.length - 1] == "BRACE") {
				segment += "|";
				continue;
			}

			if (glob[i] == "*") {
				if (extended && glob[i + 1] == "(") {
					i++;
					groupStack.push("*");
					segment += "(?:";
				} else {
					let prevChar = glob[i - 1];
					let numStars = 1;
					while (glob[i + 1] == "*") {
						i++;
						numStars++;
					}
					let nextChar = glob[i + 1];
					if (
						globstarOption && numStars == 2 &&
						[...seps, undefined].includes(prevChar) &&
						[...seps, undefined].includes(nextChar)
					) {
						segment += globstar;
						endsWithSep = true;
					} else {
						segment += wildcard;
					}
				}
				continue;
			}

			segment += regExpEscapeChars.includes(glob[i]) ? `\\${glob[i]}` : glob[i];
		}

		// Check for unclosed groups or a dangling backslash.
		if (groupStack.length > 0 || inRange || inEscape) {
			// Parse failure. Take all characters from this segment literally.
			segment = "";
			for (let c of glob.slice(j, i)) {
				segment += regExpEscapeChars.includes(c) ? `\\${c}` : c;
				endsWithSep = false;
			}
		}

		regExpString += segment;
		if (!endsWithSep) {
			regExpString += i < glob.length ? sep : sepMaybe;
			endsWithSep = true;
		}

		// Terminates with `i` at the start of the next segment.
		while (seps.includes(glob[i])) i++;

		// Check that the next value of `j` is indeed higher than the current value.
		if (!(i > j)) {
			throw new Error("Assertion failure: i > j (potential infinite loop)");
		}
		j = i;
	}

	regExpString = "^" + regExpString + "$";
	return new RegExp(regExpString);
}

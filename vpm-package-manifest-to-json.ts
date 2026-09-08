#!/usr/bin/env bun
/**
 * 概要:
 * Unity の `VPM Package Manifest` ScriptableObject（`.asset` YAML）を
 * VPM / UPM で使う package.json 形式へ変換する。
 * 対象は Script GUID（`VPMPackageManifest.cs.meta`）で判定する。
 *
 * 入力:
 * - 位置引数: 1 件以上の VPMPackageManifest `.asset` ファイル
 * - `-o` / `--out`: 任意の JSON 出力先。引数なしなら既定の出力先を使う。
 *
 * 出力:
 * - 変換結果を標準出力、または `-o` / `--out` で指定した JSON ファイルへ出す。
 * - 依存関係の `StringMapEntry[]` は JSON のオブジェクトへ変換する。
 * - 必須項目が欠ける場合はエラーで終了する。
 *
 * 実行例:
 * ```sh
 * bun vpm-package-manifest-to-json.ts "Assets/VpmRegistryCf/VPM Package Manifest.asset"
 * bun vpm-package-manifest-to-json.ts manifest.asset -o
 * bun vpm-package-manifest-to-json.ts manifest.asset -o dist/package.json
 * ```
 */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** `-o` だけ指定したときの出力先（cwd 基準。Unity の Library 配下）。 */
const DEFAULT_OUT = "Library/VpmRegistryCf/manifest.json";

/**
 * `Assets/VpmRegistryCf/VPMPackageManifest.cs.meta` の guid。
 * YAML の `m_Script.guid` と照合する。クラス名変更時は meta ごと更新すること。
 */
const VPM_PACKAGE_MANIFEST_SCRIPT_GUID = "19ddba1376a59354bbc6f5848d48faa0";

type JsonValue = string | number | boolean | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

/**
 * YAML 上は `{ key, value }[]` だが、VPM ではオブジェクトになるフィールド。
 * 例: `"vpmDependencies": { "com.vrchat.worlds": "^3.5.0" }`
 */
const MAP_FIELDS = new Set([
	"vpmDependencies",
	"legacyFolders",
	"legacyFiles",
	"dependencies",
]);

async function main() {
	const { assetPaths, outPath } = parseArgs(Bun.argv.slice(2));

	const manifests: JsonObject[] = [];
	for (const path of assetPaths) {
		const yaml = await Bun.file(path).text();
		const raw = parseUnityMonoBehaviour(yaml);
		if (!isVpmPackageManifest(raw)) {
			throw new Error(
				`${path} is not a VPMPackageManifest (m_Script.guid != ${VPM_PACKAGE_MANIFEST_SCRIPT_GUID}).`,
			);
		}
		const manifest = await toPackageJson(raw);
		validateRequiredFields(manifest, path);
		manifests.push(manifest);
	}

	if (manifests.length === 0) {
		throw new Error(
			"Found .asset files, but none looked like VPMPackageManifest.",
		);
	}

	// 1 件ならオブジェクト、複数なら配列。
	const payload = manifests.length === 1 ? manifests[0] : manifests;
	const json = `${JSON.stringify(payload, null, 2)}\n`;

	if (outPath) {
		await mkdir(dirname(outPath), { recursive: true });
		await Bun.write(outPath, json);
	} else {
		process.stdout.write(json);
	}
}

/**
 * CLI 引数を読む。位置引数はすべて `.asset`。
 * `-o` の次がフラグならパス未指定とみなし {@link DEFAULT_OUT} を使う。
 */
function parseArgs(argv: string[]): {
	assetPaths: string[];
	outPath: string | null;
} {
	const assetPaths: string[] = [];
	let outPath: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--out" || arg === "-o") {
			const next = argv[i + 1];
			if (next && !next.startsWith("-")) {
				i++;
				outPath = resolve(next);
			} else {
				outPath = resolve(DEFAULT_OUT);
			}
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			process.stdout.write(
				"Convert VPM Package Manifest .asset files to package.json\n" +
					"  bun vpm-package-manifest-to-json.ts <manifest.asset> [more.asset...] [-o [file]]\n" +
					`  -o without a path writes ${DEFAULT_OUT}\n`,
			);
			process.exit(0);
		}
		if (arg.startsWith("-")) {
			throw new Error(`Unknown option: ${arg}`);
		}
		if (!arg.endsWith(".asset")) {
			throw new Error(`Expected a .asset file, got: ${arg}`);
		}
		assetPaths.push(resolve(arg));
	}
	if (assetPaths.length === 0) {
		throw new Error(
			"Pass at least one VPM Package Manifest .asset file.\n" +
				"  bun vpm-package-manifest-to-json.ts <manifest.asset> [--out file]",
		);
	}
	return { assetPaths, outPath };
}

function normalizeGuid(value: string): string {
	return value.trim().toLowerCase();
}

/** `m_Script.guid` が VPMPackageManifest の meta と一致するか。 */
function isVpmPackageManifest(raw: JsonObject): boolean {
	const script = raw.m_Script;
	if (!script || typeof script !== "object" || Array.isArray(script))
		return false;
	const guid = (script as JsonObject).guid;
	return (
		typeof guid === "string" &&
		normalizeGuid(guid) === VPM_PACKAGE_MANIFEST_SCRIPT_GUID
	);
}

function _requireString(value: unknown, field: string, source: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(
			`${source}: Package JSON is missing required field ${field}.`,
		);
	}
	return value;
}

/**
 * ScriptableObject のフィールドを VPM `package.json` に写す。
 * `packageName`（旧シリアライズ名 `name`）→ JSON の `name`。
 * `unityPackageFolder` の PPtr は GUID からプロジェクト相対パスに直す。
 */
async function toPackageJson(raw: JsonObject): Promise<JsonObject> {
	const out: JsonObject = {};

	const name = firstString(raw.packageName, raw.name);
	if (name) out.name = name;
	const displayName = asString(raw.displayName);
	if (displayName) out.displayName = displayName;
	const version = asString(raw.version);
	if (version) out.version = version;
	const unityPackageFolder = await resolveUnityAssetPath(
		raw.unityPackageFolder,
	);
	if (unityPackageFolder) out.unityPackageFolder = unityPackageFolder;

	const author = toAuthor(raw.author);
	if (author) out.author = author;

	copyOptionalString(out, raw, "description");
	copyOptionalString(out, raw, "unity");
	copyOptionalString(out, raw, "license");
	copyOptionalString(out, raw, "url");
	copyOptionalString(out, raw, "changelogUrl");
	copyOptionalString(out, raw, "unityRelease");
	copyOptionalString(out, raw, "documentationUrl");
	copyOptionalString(out, raw, "licensesUrl");

	for (const field of MAP_FIELDS) {
		const map = toStringMap(raw[field]);
		if (map && Object.keys(map).length > 0) out[field] = map;
	}

	const legacyPackages = toStringArray(raw.legacyPackages);
	if (legacyPackages.length > 0) out.legacyPackages = legacyPackages;

	const keywords = toStringArray(raw.keywords);
	if (keywords.length > 0) out.keywords = keywords;

	const samples = toSamples(raw.samples);
	if (samples.length > 0) out.samples = samples;

	const hideInEditor = asBool(raw.hideInEditor);
	if (hideInEditor !== undefined) out.hideInEditor = hideInEditor;
	const autoGeneratePackageUrl = asBool(raw.autoGeneratePackageUrl);
	if (autoGeneratePackageUrl !== undefined)
		out.autoGeneratePackageUrl = autoGeneratePackageUrl;

	// zipSHA256 はリポジトリ一覧用の値なので package.json には含めない。
	return out;
}

/**
 * 変換結果がインストール可能な package.json になるかをここで検証する。
 * Action の後半まで不備を持ち越さないため、変換コマンド単体でも同じエラーになる。
 */
function validateRequiredFields(pkg: JsonObject, source: string) {
	for (const field of [
		"name",
		"displayName",
		"version",
		"unityPackageFolder",
	] as const) {
		_requireString(pkg[field], field, source);
	}

	const author = pkg.author;
	if (!author || typeof author !== "object" || Array.isArray(author)) {
		throw new Error(
			`${source}: Package JSON is missing required field author.`,
		);
	}
	_requireString((author as JsonObject).name, "author.name", source);
	_requireString((author as JsonObject).email, "author.email", source);
}

function firstString(...values: JsonValue[]): string | undefined {
	for (const v of values) {
		const s = asString(v);
		if (s) return s;
	}
	return undefined;
}

function asString(value: JsonValue | undefined | null): string | undefined {
	if (value == null) return undefined;
	if (typeof value === "string") return value.length > 0 ? value : undefined;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return undefined;
}

function asBool(value: JsonValue | undefined | null): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (value === 1 || value === "1" || value === "true") return true;
	if (value === 0 || value === "0" || value === "false") return false;
	return undefined;
}

function copyOptionalString(out: JsonObject, raw: JsonObject, key: string) {
	const v = asString(raw[key]);
	if (v) out[key] = v;
}

/**
 * Unity の `{fileID, guid, type}` をアセットパスにする。
 * 文字列パスが既に入っている旧データもそのまま通す。
 */
async function resolveUnityAssetPath(
	value: JsonValue | undefined,
): Promise<string | undefined> {
	if (typeof value === "string" && value.length > 0 && !value.startsWith("{")) {
		return value.replaceAll("\\", "/");
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const guid = (value as JsonObject).guid;
	if (typeof guid !== "string" || guid.length === 0 || /^0+$/.test(guid))
		return undefined;
	return findPathByGuid(normalizeGuid(guid));
}

/** `.meta` の `guid:` から、拡張子なしのアセットパスを探す。比較は小文字。 */
async function findPathByGuid(guid: string): Promise<string | undefined> {
	const want = normalizeGuid(guid);
	for (const root of ["Assets", "Packages"]) {
		const glob = new Bun.Glob(`${root}/**/*.meta`);
		for await (const file of glob.scan({
			cwd: process.cwd(),
			onlyFiles: true,
		})) {
			const text = await Bun.file(file).text();
			const match = text.match(/^guid:\s*([0-9a-fA-F]{32})\s*$/m);
			if (match && normalizeGuid(match[1]) === want) {
				return file.replace(/\.meta$/i, "").replaceAll("\\", "/");
			}
		}
	}
	return undefined;
}

function toAuthor(value: JsonValue | undefined): JsonObject | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const obj = value as JsonObject;
	const author: JsonObject = {};
	const name = asString(obj.name);
	if (name) author.name = name;
	const email = asString(obj.email);
	if (email) author.email = email;
	const url = asString(obj.url);
	if (url) author.url = url;
	return Object.keys(author).length > 0 ? author : undefined;
}

/** `StringMapEntry[]` → `{ [key]: value }`。key が空の要素は捨てる。 */
function toStringMap(value: JsonValue | undefined): JsonObject | undefined {
	if (!Array.isArray(value)) return undefined;
	const map: JsonObject = {};
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const key = asString((item as JsonObject).key);
		const val = asString((item as JsonObject).value) ?? "";
		if (key) map[key] = val;
	}
	return map;
}

function toStringArray(value: JsonValue | undefined): string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((v) => {
		const s = asString(v);
		return s ? [s] : [];
	});
}

function toSamples(value: JsonValue | undefined): JsonObject[] {
	if (!Array.isArray(value)) return [];
	const samples: JsonObject[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const obj = item as JsonObject;
		const sample: JsonObject = {};
		const displayName = asString(obj.displayName);
		if (displayName) sample.displayName = displayName;
		const description = asString(obj.description);
		if (description) sample.description = description;
		const path = asString(obj.path);
		if (path) sample.path = path;
		if (Object.keys(sample).length > 0) samples.push(sample);
	}
	return samples;
}

/**
 * Unity YAML の先頭 `MonoBehaviour` ブロックをオブジェクトにする。
 * `%TAG` / `!u!` は Bun.YAML が解けないことがあるので落としてからパースする。
 */
function parseUnityMonoBehaviour(yaml: string): JsonObject {
	const stripped = yaml
		.replace(/^\uFEFF/, "")
		.split(/\r?\n/)
		.filter((line) => !line.startsWith("%"))
		.map((line) => line.replace(/^---\s+!u!\d+(?:\s+&\d+)?\s*$/, "---"))
		.join("\n");

	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(stripped);
	} catch (error) {
		throw new Error(
			`Bun.YAML could not parse Unity YAML: ${error instanceof Error ? error.message : error}`,
		);
	}

	const docs = Array.isArray(parsed) ? parsed : [parsed];
	for (const doc of docs) {
		if (!doc || typeof doc !== "object" || Array.isArray(doc)) continue;
		const root = doc as Record<string, unknown>;
		if (
			"MonoBehaviour" in root &&
			root.MonoBehaviour &&
			typeof root.MonoBehaviour === "object"
		) {
			return root.MonoBehaviour as JsonObject;
		}
	}
	throw new Error("No MonoBehaviour block in YAML");
}

await main();

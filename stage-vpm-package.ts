#!/usr/bin/env bun
/**
 * 概要:
 * Unity プロジェクトの元の配置を変えずに、VPM 配布用 ZIP の展開内容を作成する。
 * 深い階層の Editor フォルダーは Editor へ、それ以外は Runtime へ配置し、
 * Samples~、Documentation~、Tests とドキュメントはパッケージ直下に残す。
 *
 * 入力:
 * - 第 1 引数: `unityPackageFolder` を含む manifest.json のパス
 * - 第 2 引数: ステージング先ディレクトリ
 * - 第 3 引数: 任意のパッケージ ZIP の公開 URL
 *
 * 出力:
 * - ステージング先に VPM 用 package.json と配布用のファイル配置を作成する。
 *
 * 実行例:
 * ```sh
 * bun stage-vpm-package.ts build/manifest.json build/staged https://example.com/package.zip
 * ```
 */

import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

type JsonObject = Record<string, unknown>;

const [manifestArg, outputArg, releaseUrl] = Bun.argv.slice(2);
if (!manifestArg || !outputArg) {
	throw new Error(
		"Usage: bun stage-vpm-package.ts <manifest.json> <output-directory> [release-url]",
	);
}

const manifest = (await Bun.file(resolve(manifestArg)).json()) as JsonObject;
const source =
	typeof manifest.unityPackageFolder === "string"
		? resolve(manifest.unityPackageFolder)
		: "";
if (!source) throw new Error("Package JSON is missing unityPackageFolder.");
const sourceStat = await stat(source).catch(() => null);
if (!sourceStat?.isDirectory())
	throw new Error(`Package folder does not exist: ${source}`);

const destination = resolve(outputArg);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
const runtime = join(destination, "Runtime");
const editor = join(destination, "Editor");
const standardDirectories = new Set(["Samples~", "Documentation~", "Tests"]);
const documentationFiles = new Set([
	"README.md",
	"CHANGELOG.md",
	"LICENSE",
	"LICENSE.md",
	"Third Party Notices.md",
]);
const entries = await readdir(source, { withFileTypes: true });

/**
 * 特別な扱いをしない項目を Runtime にコピーする。
 * `.meta` も同じ配置にすることで、Unity が管理する GUID の対応を保つ。
 */
async function copyRuntimeEntry(name: string) {
	await mkdir(runtime, { recursive: true });
	await cp(join(source, name), join(runtime, name), {
		recursive: true,
		force: true,
	});
}

for (const entry of entries) {
	const name = entry.name;
	if (name === "package.json" || name === "package.json.meta") continue;

	if (name === "Runtime" && entry.isDirectory()) {
		await cp(join(source, name), runtime, { recursive: true, force: true });
		continue;
	}
	if (name === "Editor" && entry.isDirectory()) {
		await cp(join(source, name), editor, { recursive: true, force: true });
		continue;
	}
	if (standardDirectories.has(name) && entry.isDirectory()) {
		await cp(join(source, name), join(destination, name), {
			recursive: true,
			force: true,
		});
		continue;
	}

	if (name.endsWith(".meta")) {
		const baseName = name.slice(0, -5);
		if (
			baseName === "Runtime" ||
			baseName === "Editor" ||
			standardDirectories.has(baseName) ||
			documentationFiles.has(baseName)
		) {
			await cp(join(source, name), join(destination, name), { force: true });
		} else {
			await copyRuntimeEntry(name);
		}
		continue;
	}

	if (entry.isFile() && documentationFiles.has(name)) {
		await cp(join(source, name), join(destination, name), { force: true });
		continue;
	}

	await copyRuntimeEntry(name);
}

async function findNestedEditorDirectories(
	current: string,
	relativePath = "",
): Promise<Array<{ path: string; parentRelativePath: string }>> {
	const found: Array<{ path: string; parentRelativePath: string }> = [];
	for (const entry of await readdir(current, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const childPath = join(current, entry.name);
		if (entry.name === "Editor") {
			found.push({ path: childPath, parentRelativePath: relativePath });
			continue;
		}
		const childRelativePath = relativePath
			? join(relativePath, entry.name)
			: entry.name;
		found.push(
			...(await findNestedEditorDirectories(childPath, childRelativePath)),
		);
	}
	return found;
}

// Unity では深い階層でも Editor という名前のフォルダーはエディター専用になる。
// 親フォルダーからの相対パスを保ったまま、パッケージ直下の Editor に移動する。
if (
	await stat(runtime)
		.then((value) => value.isDirectory())
		.catch(() => false)
) {
	for (const nestedEditor of await findNestedEditorDirectories(runtime)) {
		const target = join(editor, nestedEditor.parentRelativePath);
		await mkdir(target, { recursive: true });
		await cp(nestedEditor.path, target, { recursive: true, force: true });
		await rm(nestedEditor.path, { recursive: true, force: true });
		await rm(`${nestedEditor.path}.meta`, { force: true });
	}
}
const hasRuntime = await stat(runtime)
	.then((value) => value.isDirectory())
	.catch(() => false);
const hasEditor = await stat(editor)
	.then((value) => value.isDirectory())
	.catch(() => false);
if (!hasRuntime && !hasEditor) {
	throw new Error(
		"VPM package staging produced neither a Runtime nor an Editor directory.",
	);
}

if (hasRuntime) {
	const glob = new Bun.Glob("Runtime/**/*.cs");
	for await (const file of glob.scan({ cwd: destination, onlyFiles: true })) {
		const text = await Bun.file(join(destination, file)).text();
		if (/\bUnityEditor\b/.test(text)) {
			throw new Error(`UnityEditor API found in staged Runtime file: ${file}`);
		}
	}
}

const packageJson = { ...manifest };
delete packageJson.unityPackageFolder;
delete packageJson.autoGeneratePackageUrl;

// 公開リポジトリはリリース URL を組み立てられる。非公開リポジトリは GitHub の
// リリース資産を匿名取得できないため、呼び出し側が渡したプレースホルダーを使う。
if (manifest.autoGeneratePackageUrl !== false) {
	if (!releaseUrl)
		throw new Error("Automatic package URL generation requires a release URL.");
	packageJson.url = releaseUrl;
} else if (
	typeof manifest.url !== "string" ||
	manifest.url.trim().length === 0
) {
	throw new Error(
		"Package JSON url is required when automatic URL generation is disabled.",
	);
}
await Bun.write(
	join(destination, "package.json"),
	`${JSON.stringify(packageJson, null, 2)}\n`,
);

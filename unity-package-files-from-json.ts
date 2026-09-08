#!/usr/bin/env bun
/**
 * 概要:
 * package.json の `unityPackageFolder` 以下にある `.meta` を列挙し、
 * `.unitypackage` 作成用の Packed File List を作る。VPM 用の Runtime / Editor 分離は
 * 別のステージング処理が担当する。
 *
 * 入力:
 * - 第 1 引数: `unityPackageFolder` を含む manifest.json のパス
 *
 * 出力:
 * - 梱包する `.meta` のプロジェクト相対パスを、ソートして標準出力へ出す。
 *
 * 実行例:
 * ```sh
 * bun unity-package-files-from-json.ts build/manifest.json > build/unity-package-files.txt
 * ```
 */

import { resolve } from "node:path";

type PackageJson = { unityPackageFolder?: unknown };

function posix(path: string): string {
	// Unity の pathname は OS に関係なくスラッシュ区切りで保存する。
	return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

async function main() {
	const argv = Bun.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(
			"Build a Packed File List (.meta paths) from Package JSON\n  bun unity-package-files-from-json.ts <manifest.json>\n",
		);
		return;
	}
	if (argv.length !== 1 || argv[0].startsWith("-")) {
		throw new Error("Pass exactly one Package JSON file.");
	}

	const pkg = (await Bun.file(resolve(argv[0])).json()) as PackageJson;
	const folder =
		typeof pkg.unityPackageFolder === "string"
			? posix(pkg.unityPackageFolder)
			: "";
	if (!folder) throw new Error("Package JSON is missing unityPackageFolder.");

	const files = new Set<string>();
	const addMeta = async (assetPath: string) => {
		const meta = `${posix(assetPath)}.meta`;
		// フォルダー自身の .meta も GUID を持つため、子要素とは別に必ず確認する。
		if (await Bun.file(meta).exists()) files.add(meta);
	};
	await addMeta(folder);
	// 子アセットは .meta を基準に列挙する。対応する本体がないフォルダーも含められる。
	const glob = new Bun.Glob(`${folder}/**/*.meta`);
	for await (const file of glob.scan({ cwd: process.cwd(), onlyFiles: true })) {
		files.add(posix(file));
	}

	const listed = [...files].sort((a, b) => a.localeCompare(b));
	if (listed.length === 0) throw new Error("Packed File List is empty.");
	process.stdout.write(`${listed.join("\n")}\n`);
}

await main();

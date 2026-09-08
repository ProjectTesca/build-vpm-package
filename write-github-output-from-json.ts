#!/usr/bin/env bun
/**
 * 概要:
 * manifest.json の公開に必要な値を検証し、GitHub Actions の複合 Action 出力へ書き出す。
 *
 * 入力:
 * - 第 1 引数: name、version、displayName、author を含む manifest.json のパス
 * - 環境変数 `GITHUB_OUTPUT`: GitHub Actions が指定する出力ファイル
 * - 環境変数 `EXPECTED_PACKAGE_NAME`: 任意の期待パッケージ名
 *
 * 出力:
 * - `name`、`version`、`displayName`、`tag` を `GITHUB_OUTPUT` へ追記する。
 *
 * 実行例:
 * ```sh
 * GITHUB_OUTPUT="$GITHUB_OUTPUT" bun write-github-output-from-json.ts build/manifest.json
 * ```
 */
import { appendFile } from "node:fs/promises";

async function main() {
	const jsonPath = Bun.argv[2];
	const outputPath = process.env.GITHUB_OUTPUT;
	const expectedPackageName = process.env.EXPECTED_PACKAGE_NAME;
	if (!jsonPath) throw new Error("Pass a Package JSON path.");
	if (!outputPath) throw new Error("GITHUB_OUTPUT is not set.");

	const pkg = (await Bun.file(jsonPath).json()) as Record<string, unknown>;
	const { name, version, displayName } = readPackageIdentity(pkg);
	if (expectedPackageName && name !== expectedPackageName) {
		throw new Error(
			`manifest.json name '${name}' does not match requested packageName '${expectedPackageName}'`,
		);
	}
	if (displayName.includes("END_DISPLAY_NAME"))
		throw new Error("displayName must not contain END_DISPLAY_NAME");

	const tag = `${name}-v${version}`;
	// ヒアドキュメント形式なら、改行を含む displayName も GITHUB_OUTPUT に渡せる。
	await appendFile(
		outputPath,
		`name=${name}\nversion=${version}\ntag=${tag}\ndisplayName<<END_DISPLAY_NAME\n${displayName}\nEND_DISPLAY_NAME\n`,
	);
}

function readPackageIdentity(pkg: Record<string, unknown>) {
	for (const key of ["name", "version", "displayName"] as const) {
		if (typeof pkg[key] !== "string" || pkg[key].length === 0)
			throw new Error(`manifest.json missing ${key}`);
	}
	const author = pkg.author as Record<string, unknown> | undefined;
	if (
		!author ||
		typeof author.name !== "string" ||
		!author.name ||
		typeof author.email !== "string" ||
		!author.email
	)
		throw new Error("manifest.json missing author name or email");

	return {
		name: pkg.name,
		version: pkg.version,
		displayName: pkg.displayName,
	} as { name: string; version: string; displayName: string };
}

await main();

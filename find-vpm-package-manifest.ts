#!/usr/bin/env bun
/**
 * 概要:
 * Unity プロジェクト内から VPMPackageManifest の ScriptableObject を 1 件だけ探す。
 * ファイル名ではなくスクリプト GUID を照合するため、名前が似たアセットを誤検出しない。
 *
 * 入力:
 * - 第 1 引数: 任意のパッケージ名。省略時は候補が 1 件だけである必要がある。
 * - 第 2 引数: 検索開始ディレクトリ。省略時は `Assets`。
 *
 * 出力:
 * - 見つかった `.asset` のプロジェクト相対パスを標準出力へ出す。
 *
 * 実行例:
 * ```sh
 * bun find-vpm-package-manifest.ts com.example.package Assets
 * ```
 */

/** VPMPackageManifest MonoBehaviour を表すスクリプトの GUID。 */
const [packageName = "", searchPath = "Assets"] = Bun.argv.slice(2);
const guid = "19ddba1376a59354bbc6f5848d48faa0";
const matches: string[] = [];

// Unity のアセットは YAML なので、ファイル名ではなくスクリプト GUID で確実に判定する。
for await (const path of new Bun.Glob(
	`${searchPath.replaceAll("\\", "/")}/**/*.asset`,
).scan({ cwd: process.cwd(), onlyFiles: true })) {
	const yaml = await Bun.file(path).text();
	if (!yaml.includes(guid)) continue;
	const value = yaml
		.match(/^ {2}(?:packageName|name):\s*(.+)\s*$/m)?.[1]
		?.trim();
	if (!packageName || value === packageName)
		matches.push(path.replaceAll("\\", "/"));
}
if (matches.length === 0)
	throw new Error(
		`No VPMPackageManifest${packageName ? ` with packageName '${packageName}'` : ""} under ${searchPath}.`,
	);
if (matches.length > 1) {
	if (!packageName)
		throw new Error(
			`Multiple VPMPackageManifest assets were found under ${searchPath}. Specify packageName.\n${matches.join("\n")}`,
		);
	throw new Error(
		`packageName '${packageName}' is ambiguous:\n${matches.join("\n")}`,
	);
}
process.stdout.write(matches[0]);

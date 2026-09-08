#!/usr/bin/env bun
/**
 * 概要:
 * `.meta` の一覧から、Unity が読み込める `.unitypackage` を作成する。
 * GUID ごとに `asset`、`asset.meta`、`pathname` を配置し、tar で圧縮する。
 *
 * 入力:
 * - 第 1 引数: 梱包対象の `.meta` パスを 1 行ずつ記載した一覧ファイル
 * - 第 2 引数: 作成する `.unitypackage` の出力パス
 *
 * 出力:
 * - 指定した出力パスに `.unitypackage` ファイルを作成する。
 *
 * 実行例:
 * ```sh
 * bun create-unity-package.ts build/unity-package-files.txt build/example.unitypackage
 * ```
 */
import { cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

async function main() {
	const [list, output] = Bun.argv.slice(2);
	if (!list || !output)
		throw new Error("Usage: create-unity-package.ts <meta-list> <output>");

	const staging = await mkdtemp(join(tmpdir(), "unitypackage-"));
	try {
		const metaPaths = (await Bun.file(resolve(list)).text())
			.split(/\r?\n/)
			.filter(Boolean);
		for (const metaPath of metaPaths) await addAsset(staging, metaPath);

		await mkdir(dirname(resolve(output)), { recursive: true });
		const archive = Bun.spawn(
			["tar", "-czf", resolve(output), "-C", staging, "."],
			{ stdout: "inherit", stderr: "inherit" },
		);
		if ((await archive.exited) !== 0) throw new Error("tar failed");
	} finally {
		// 圧縮後は一時データを残さない。途中で失敗した場合も同様に掃除する。
		await rm(staging, { recursive: true, force: true });
	}
}

/**
 * `.meta` 1 件を Unity package のエントリに変換する。
 * フォルダーにはアセット本体がないため空ファイルを置くが、メタデータは必ず残す。
 */
async function addAsset(staging: string, metaPath: string) {
	const meta = await Bun.file(resolve(metaPath)).text();
	const guid = meta.match(/^guid:\s*([0-9a-fA-F]{32})\s*$/m)?.[1];
	if (!guid) throw new Error(`No GUID in ${metaPath}`);

	const assetPath = metaPath.slice(0, -5).replaceAll("\\", "/");
	const entry = join(staging, guid);
	await mkdir(entry, { recursive: true });
	await Bun.write(join(entry, "asset.meta"), meta);
	await Bun.write(join(entry, "pathname"), assetPath);

	const source = resolve(assetPath);
	if ((await stat(source).catch(() => undefined))?.isFile())
		await cp(source, join(entry, "asset"));
	else await Bun.write(join(entry, "asset"), "");
}

await main();

# Build VPM package

vpm-registry-cfのCI用ステップ

次の3つを生成します。
- ScriptableObjectの`manifest.json`
- VPM配布用ZIPファイル
- Unityの`.unitypackage`ファイル

Action内でBunを利用します。実行環境にBunがなければ自動的に導入するため、呼び出すワークフロー側でNode.jsやBunを設定する必要はありません。

## 前提条件

- GitHub ActionsのLinuxランナー、または`bash`、`tar`、`zip`が利用できるセルフホストランナーで実行すること
- Unityプロジェクトに対象の`VPMPackageManifest` ScriptableObjectが存在すること
- マニフェストに次の値が設定されていること
  - `name`
  - `displayName`
  - `version`
  - `author.name`
  - `author.email`
  - `unityPackageFolder`
- `unityPackageFolder`以下のアセットと`.meta`ファイルをリポジトリに含めること

対象アセットはファイル名ではなく`VPMPackageManifest`のスクリプトGUIDで検出します。そのため、同じ検索範囲に複数のマニフェストがある場合は`package-name`を指定してください。

## 使い方

同じリポジトリにActionを置く場合の例です。リリース済みのActionを利用する場合は`uses: <所有者>/<リポジトリ>@<タグ名>`に置き換えてください。

```yaml
name: Build package

on:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - id: package
        uses: ./
        with:
          package-name: com.example.my-package
          manifest-search-path: Assets
          output-directory: build/vpm
          repository-private: "false"

      - uses: actions/upload-artifact@v4
        with:
          name: ${{ steps.package.outputs.package-name }}-${{ steps.package.outputs.version }}
          path: |
            ${{ steps.package.outputs.manifest-path }}
            ${{ steps.package.outputs.zip-path }}
            ${{ steps.package.outputs.unitypackage-path }}
```

## 入力

| 名前 | 必須 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `package-name` | いいえ | `""` | 対象のVPMパッケージ名。検索範囲にマニフェストが1件だけなら省略できます。 |
| `manifest-search-path` | いいえ | `Assets` | `VPMPackageManifest`を検索し始めるディレクトリです。 |
| `output-directory` | いいえ | `build/vpm` | `manifest.json`、ZIP、`.unitypackage`の出力先です。 |
| `repository-private` | いいえ | `"false"` | 非公開リポジトリなら`"true"`を指定します。 |

## 出力

| 名前 | 説明 |
| --- | --- |
| `package-name` | 変換した`manifest.json`のパッケージ名です。 |
| `version` | 変換した`manifest.json`のバージョンです。 |
| `display-name` | 変換した`manifest.json`の表示名です。 |
| `tag` | `パッケージ名-vバージョン`形式のリリースタグです。 |
| `manifest-path` | 生成したVPM用`manifest.json`のパスです。 |
| `zip-path` | 生成したVPM配布用ZIPのパスです。 |
| `unitypackage-path` | 生成した`.unitypackage`のパスです。 |

既定の出力先では、パッケージ名を`com.example.my-package`、バージョンを`1.2.3`とした場合、次のファイルが作成されます。

```text
build/vpm/
├── manifest.json
├── com.example.my-package-1.2.3.zip
└── com.example.my-package-1.2.3.unitypackage
```

作業用の`build/vpm/staged`と`build/vpm/unity-package-files.txt`も作られます。これらは配布物ではありません。

## VPM ZIPの配置規則

`unityPackageFolder`の内容は、配布ZIP内で次のように整理されます。

| 元の項目 | ZIP内の配置 |
| --- | --- |
| `Editor`、または任意の深さの`Editor`フォルダー | `Editor`以下 |
| `Runtime` | `Runtime`以下 |
| 上記以外の通常のアセット | `Runtime`以下 |
| `Samples~`、`Documentation~`、`Tests` | パッケージ直下 |
| `README.md`、`CHANGELOG.md`、`LICENSE`、`LICENSE.md`、`Third Party Notices.md` | パッケージ直下 |

ZIP作成時には、`Runtime`以下のC#ファイルに`UnityEditor` APIが含まれていないことも確認します。検出した場合は、エディター専用コードを`Editor`フォルダーへ移すまでビルドを停止します。

## リリースURL

マニフェストで`autoGeneratePackageUrl`が`false`以外の場合、生成したZIPのURLは次の形式になります。

```text
https://github.com/<所有者>/<リポジトリ>/releases/download/<パッケージ名-vバージョン>/<パッケージ名>-<バージョン>.zip
```

このActionはZIPを作成しますが、GitHub Releaseの作成やZIPのアップロードは行いません。公開配布する場合は、出力された`tag`のReleaseを作り、`zip-path`のZIPをそのReleaseにアップロードしてください。

非公開リポジトリで`repository-private: "true"`を指定すると、公開取得できないGitHub Release URLの代わりに安全なプレースホルダーURLを設定します。実際に利用可能なURLをpackage.jsonに入れたい場合は、マニフェストで`autoGeneratePackageUrl`を`false`にし、`url`を明示してください。

## 失敗する主なケース

- マニフェストが見つからない、または複数あり `package-name` で絞り込めない
- 必須項目や `unityPackageFolder` が未設定
- `unityPackageFolder` が存在しない
- `.unitypackage`に含める`.meta`が1件もない
- `Runtime`に`UnityEditor` APIを使用するC#ファイルがある
- `autoGeneratePackageUrl`が有効なのにZIPの公開URLを決められない

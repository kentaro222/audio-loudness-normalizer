# Audio Loudness Normalizer

ブラウザ内のFFmpeg WASMで音声を解析し、MP3・OGGへ変換します。
音声は外部サーバーにアップロードされません。

## 起動

このディレクトリで次を実行します（ビルド不要）。

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

## 元音声のラウドネス判定

ファイル選択時に自動解析し、実測LUFSとトゥルーピークを表示します。

- **目標範囲内**：−14.5〜−13.5 LUFS（両端を含む）、かつ −1.5 dBTP以下
- **調整を推奨**：上記の範囲外。理由も表示します。
- **判定できません**：無音、測定できない短い音声、非対応・破損ファイルなど

過去にノーマライズしたかどうかの判定ではありません。
解析は音声全体を読み取るため、長いファイルでは時間がかかります。
解析中・変換中のファイル切り替えはできません。
「目標範囲内」でも必要なら従来どおり変換できます。

## 動作テスト

Node.js、Python、FFmpeg（ffprobe含む）、Chromiumが必要です。
テスト用依存はチェックアウト外に導入できます。

```sh
npm install --prefix /tmp/audio-loudness-tests playwright-core@1.58.2
# 上記のHTTPサーバーを別ターミナルで起動した状態で実行
NODE_PATH=/tmp/audio-loudness-tests/node_modules node tests/loudness.cjs
```

Chromiumのパスは `CHROMIUM_PATH`、接続先は `TEST_URL` で指定できます。
小音量・目標範囲内・大音量・無音・破損音声の判定と、
エラー後の復帰、MP3・OGGの変換・ダウンロードを検証します。

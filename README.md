# 万象録（ばんしょうろく）

文章で行動を書くと、AI のゲームマスター（Claude）が結果と世界の反応を決めるシミュレーションゲームの試作。

- **国を率いる**: 架空の大陸の小国の公主として、外交・戦・内政・謀略を自由な文章で命じる。
- **作品世界に入る**: 好きな作品に、新しい登場人物として入り込む（個人で楽しむ範囲で）。
- **自由な世界**: 設定と立場を書くと、数値・勢力ごと世界を組み立てる。

`bansho.html` 1 枚で動く。claude.ai の Artifact として公開し、`sample` 機能（ページから Claude を呼ぶ）で AI を使う。claude.ai の外で開くと AI は使えない。

仕様は [docs/DESIGN.md](docs/DESIGN.md)。

## 素材の出典
- 都道府県の地図の形: [Natural Earth](https://www.naturalearthdata.com/) 1:10m Admin 1（パブリックドメイン）。`tools/geo-convert.py` で SVG に変換・簡略化して `bansho.html` に埋め込んでいる。区画は同じデータを `tools/geo-districts.py`（中心点は `tools/geo-seeds.py`）でボロノイ分割して作った。

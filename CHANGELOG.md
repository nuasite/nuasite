# Changelog

## [0.8.2](https://github.com/nuasite/nuasite/compare/v0.8.1...v0.8.2) (2026-02-14)


### Bug Fixes

* **cms:** add non-null assertion for innerContent in source-writer ([32dd2b2](https://github.com/nuasite/nuasite/commit/32dd2b29127ea43e9d8b0621e1ceccb321ba55df))
* **cms:** complete bg image applyForward with full state and storage imports ([ff4c463](https://github.com/nuasite/nuasite/commit/ff4c463fa180f9e44e0336f52965e7e73aec8362))
* **cms:** handle text edits spanning inline HTML elements ([56b67b6](https://github.com/nuasite/nuasite/commit/56b67b6aac83c93d600536f033adc8a2fcf16d8d))
* **cms:** resolve CMS placeholders in originalValue before text replacement ([e7f1f37](https://github.com/nuasite/nuasite/commit/e7f1f377cda3b00c1f32e44e4a85d1c64d9f5023))
* **lint:** allow unused tsconfig references for build-only dependencies ([516a7a8](https://github.com/nuasite/nuasite/commit/516a7a889377b8fa3bb39744b4bdd8c1cb826b63))
* **llm-enhancements:** add project reference to cms for tsc --build ([b760ef9](https://github.com/nuasite/nuasite/commit/b760ef932ad443dffc4dd8b9c92f81432cc611bc))

## [0.8.1](https://github.com/nuasite/nuasite/compare/v0.8.0...v0.8.1) (2026-02-13)

### Bug Fixes

- **cms:** add undo/redo for background image editing ([cacc6af](https://github.com/nuasite/nuasite/commit/cacc6affafd7d713d80cd16284e56ad5a4d22eee))

## [0.8.0](https://github.com/nuasite/nuasite/compare/v0.7.3...v0.8.0) (2026-02-13)

### Features

- **cms:** add background image editing support ([f90c94e](https://github.com/nuasite/nuasite/commit/f90c94e89c24bd813127a2071c61a04dfd842af1))

### Bug Fixes

- **cms:** handle bg-[url()] with quotes inside class attribute regex ([d6d5b48](https://github.com/nuasite/nuasite/commit/d6d5b48a840bc5f39a9dbcb68d154bb26c9dc005))

## [0.7.3](https://github.com/nuasite/nuasite/compare/v0.7.2...v0.7.3) (2026-02-12)

### Bug Fixes

- **cms:** exempt &lt;a&gt; elements from pure container skip ([2dfca89](https://github.com/nuasite/nuasite/commit/2dfca89119edf48d4a2932616839b850d0bb3f48))
- **cms:** skip bare spans without classes in editable HTML processing ([9ef4f87](https://github.com/nuasite/nuasite/commit/9ef4f87270bc2f2d7374e2b41e4fe6314a2f4e9f))

## [0.7.2](https://github.com/nuasite/nuasite/compare/v0.7.1...v0.7.2) (2026-02-12)

### Bug Fixes

- **cms:** strip editor-only attributes from styled spans in editable HTML ([403ab6c](https://github.com/nuasite/nuasite/commit/403ab6c1b6d5b68eba6546fb5a88baa2128bca02))

## [0.7.1](https://github.com/nuasite/nuasite/compare/v0.7.0...v0.7.1) (2026-02-12)

### Bug Fixes

- **cms:** position block editor above cursor when space below is insufficient ([19c7a39](https://github.com/nuasite/nuasite/commit/19c7a39f0d983e65058a6ae1ca95117fa3a18960))
- **cms:** reduce element toolbar hover hitbox overshoot ([9b00675](https://github.com/nuasite/nuasite/commit/9b006751c23df1ad8d0489e3e696afc7c6d49210))

## [0.7.0](https://github.com/nuasite/nuasite/compare/v0.6.0...v0.7.0) (2026-02-12)

### Features

- **cms:** add element-level text style controls in outline toolbar ([bf5bc50](https://github.com/nuasite/nuasite/commit/bf5bc50306b4e3811aa473767c21e1b93bf621dc))
- **cms:** extract text style classes and add allowStyling flag ([bd77682](https://github.com/nuasite/nuasite/commit/bd776829d0e0273c7f48bc0c77254a30320058b5))

### Bug Fixes

- **cms:** prevent text deselection on style toolbar mousedown ([a6b6938](https://github.com/nuasite/nuasite/commit/a6b6938823e5c049d8bfbb3775853d0c4e646599))

## [0.6.0](https://github.com/nuasite/nuasite/compare/v0.5.1...v0.6.0) (2026-02-12)

### Features

- **cms:** add array element prop extraction utilities ([2bbb918](https://github.com/nuasite/nuasite/commit/2bbb918e4c0156979a0671ce2ae81df8883f8c35))
- **cms:** add object field support in frontmatter editor ([4475d6f](https://github.com/nuasite/nuasite/commit/4475d6ff844e30abc9538f8565c41c024fd3907c))
- **cms:** make error toasts persistent with dismiss button ([2886ee4](https://github.com/nuasite/nuasite/commit/2886ee47ee529fb31f23fe628fdf40b34f3582f4))
- **cms:** open markdown editor for entries without detail pages ([efcf1b3](https://github.com/nuasite/nuasite/commit/efcf1b3d809d311a046bfb27e58289599f0b3977))
- **cms:** resolve spread props for array-rendered components ([c7605f3](https://github.com/nuasite/nuasite/commit/c7605f30c261422a2efbebc1b7ea26c41e62ee19))
- **cms:** track spread props from .map() loops in source-finder ([8e97379](https://github.com/nuasite/nuasite/commit/8e973791f4785fefd87c7884f02e18fb9b6b7667))

### Bug Fixes

- **cms:** prevent Enter and Shift+Enter in inline contentEditable ([132d61f](https://github.com/nuasite/nuasite/commit/132d61f08be4324f53cf27f389c87375ce9fbf53))
- **cms:** show error details in save failure toasts ([603abbd](https://github.com/nuasite/nuasite/commit/603abbd4400746370188de6669dbfb5654103ff1))
- **cms:** use fs.stat for import resolution instead of fs.access ([4eb2c41](https://github.com/nuasite/nuasite/commit/4eb2c416a86fc470b9800bcf13deeaefe8ec3f61))

### Performance Improvements

- **cms:** skip deployment polling when deployment is unavailable ([564cc30](https://github.com/nuasite/nuasite/commit/564cc302dcf35956c72370a0902d5de259df7abf))

## [0.5.1](https://github.com/nuasite/nuasite/compare/v0.5.0...v0.5.1) (2026-02-12)

### Bug Fixes

- **cms:** handle Enter key with &lt;br&gt; instead of browser-default &lt;div&gt; blocks ([e33eda4](https://github.com/nuasite/nuasite/commit/e33eda41bd9b5cea8cda14897dc2b9b801f70762))
- **cms:** trace prop-driven text to parent component source ([66704bb](https://github.com/nuasite/nuasite/commit/66704bbae6b6e25e313b7b4df5413f852f03a3e7))

## [0.5.0](https://github.com/nuasite/nuasite/compare/v0.4.0...v0.5.0) (2026-02-11)

### Features

- **cms:** pre-bundle editor for npm distribution ([1cfee49](https://github.com/nuasite/nuasite/commit/1cfee494bc6c1ba2fcdc7477ed6f39a627001c64))

## [0.4.0](https://github.com/nuasite/nuasite/compare/v0.3.1...v0.4.0) (2026-02-11)

### Features

- **cms:** discover pages from filesystem and include in manifest ([f43b662](https://github.com/nuasite/nuasite/commit/f43b662d13f0d118dec58b6ea6e2d486b79d7bcd))
- **editor:** improve outline toolbar UX and unify color swatches ([4751990](https://github.com/nuasite/nuasite/commit/47519904acf6eb0a8ad88341b0393bbe3f9ebdc7))

## [0.3.1](https://github.com/nuasite/nuasite/compare/v0.3.0...v0.3.1) (2026-02-11)

### Bug Fixes

- **cms:** resolve biome lint errors ([149b7f0](https://github.com/nuasite/nuasite/commit/149b7f0820acf2ee79181a724b76b5cb51a49c4f))

## [0.3.0](https://github.com/nuasite/nuasite/compare/v0.2.2...v0.3.0) (2026-02-11)

### Features

- **cms:** add array item add/remove operations ([4d19aa7](https://github.com/nuasite/nuasite/commit/4d19aa7cf477b92d4effeef9a9c68c5c7bebace0))
- **cms:** extract component props from source and improve component ops ([c13bc10](https://github.com/nuasite/nuasite/commit/c13bc10e64dfb397c255167334915e1705f51408))
- **editor:** contrast-aware outline colors for dark backgrounds ([f8731dc](https://github.com/nuasite/nuasite/commit/f8731dcf167e90bc4423776a2739172c017fb85a))
- **editor:** persist edit mode across HMR/page refresh ([47baf75](https://github.com/nuasite/nuasite/commit/47baf7579f71fc4a9bd834988c9b42ee68fdafee))
- **editor:** track previous styles in color change handler ([5072c13](https://github.com/nuasite/nuasite/commit/5072c13b528d0d6f8edc6a68d24bc9823629463d))
- **nua:** hide Astro dev toolbar in dev mode ([aafa519](https://github.com/nuasite/nuasite/commit/aafa519a784e9679f04e8ee485eba87301775f8b))

### Bug Fixes

- **cms:** extract inline comments from source line instead of Babel AST ([6ac0ab6](https://github.com/nuasite/nuasite/commit/6ac0ab6fbd28dd6c370670baf6df52dbed6dd544))

## [0.2.2](https://github.com/nuasite/nuasite/compare/v0.2.1...v0.2.2) (2026-02-11)

### Bug Fixes

- **ci:** use workflow_dispatch so npm provenance sees publish.yaml ([ccdee24](https://github.com/nuasite/nuasite/commit/ccdee24fb78b408bb9c62fd01265be5192d40407))

## [0.2.1](https://github.com/nuasite/nuasite/compare/v0.2.0...v0.2.1) (2026-02-11)

### Bug Fixes

- **ci:** grant id-token permission for npm provenance ([c001edc](https://github.com/nuasite/nuasite/commit/c001edc554a1925c1902e472fa8f105531de13f9))
- **ci:** trigger npm publish from release-please workflow ([c42ee79](https://github.com/nuasite/nuasite/commit/c42ee797bc66d69ff0a63c604f7b3c2377c10944))

## [0.2.0](https://github.com/nuasite/nuasite/compare/v0.1.2...v0.2.0) (2026-02-11)

### Features

- **playground:** transform into multi-page ecosystem showcase ([7047b89](https://github.com/nuasite/nuasite/commit/7047b89dc5cc15b5cd93f2671875c88775f0adf3))

### Bug Fixes

- **ci:** add checkout step before lockfile update in release workflow ([ea66615](https://github.com/nuasite/nuasite/commit/ea6661544d31073baa4e9514b53b9070853b430d))

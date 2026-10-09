# Third-Party Licenses

This inventory is generated from the committed CycloneDX 1.5 SBOMs in `docs/sbom/`. It covers required and optional shipped dependencies; development-only, SDK, and other excluded components are not treated as shipped dependencies by the release license gate.

SBOM timestamp: 2026-10-08T00:00:00Z

## Review summary

- Shipped package versions reviewed: 716
- Excluded components omitted from this shipped-dependency inventory: 717
- Unresolved shipped license entries: 0
- Reviewed GPL, AGPL, or SSPL exceptions: 0

## Dependency inventory

### (MIT OR Apache-2.0) AND Unicode-3.0

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| unicode-ident | 1.0.26 | required | pkg:cargo/unicode-ident@1.0.26 | packages/sdk-rust/Cargo.lock | crates.io version metadata unicode-ident@1.0.26 |

### (MIT OR CC0-1.0)

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| type-fest | 0.20.2 | required | pkg:npm/type-fest@0.20.2 | package-lock.json#node_modules/type-fest | lockfile |

### 0BSD

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| tslib | 2.8.1 | required | pkg:npm/tslib@2.8.1 | package-lock.json#node_modules/tslib | lockfile |

### Apache-2.0

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| @firebase/app-check-interop-types | 0.3.5 | optional | pkg:npm/@firebase/app-check-interop-types@0.3.5 | package-lock.json#node_modules/@firebase/app-check-interop-types | lockfile |
| @firebase/app-types | 0.9.6 | optional | pkg:npm/@firebase/app-types@0.9.6 | package-lock.json#node_modules/@firebase/app-types | lockfile |
| @firebase/auth-interop-types | 0.2.6 | optional | pkg:npm/@firebase/auth-interop-types@0.2.6 | package-lock.json#node_modules/@firebase/auth-interop-types | lockfile |
| @firebase/component | 0.7.5 | optional | pkg:npm/@firebase/component@0.7.5 | package-lock.json#node_modules/@firebase/component | lockfile |
| @firebase/database-compat | 2.1.7 | optional | pkg:npm/@firebase/database-compat@2.1.7 | package-lock.json#node_modules/@firebase/database-compat | lockfile |
| @firebase/database-types | 1.0.22 | optional | pkg:npm/@firebase/database-types@1.0.22 | package-lock.json#node_modules/@firebase/database-types | lockfile |
| @firebase/database | 1.1.5 | optional | pkg:npm/@firebase/database@1.1.5 | package-lock.json#node_modules/@firebase/database | lockfile |
| @firebase/logger | 0.5.2 | optional | pkg:npm/@firebase/logger@0.5.2 | package-lock.json#node_modules/@firebase/logger | lockfile |
| @firebase/util | 1.15.3 | optional | pkg:npm/@firebase/util@1.15.3 | package-lock.json#node_modules/@firebase/util | lockfile |
| @google-cloud/firestore-api | 0.2.0 | optional | pkg:npm/@google-cloud/firestore-api@0.2.0 | package-lock.json#node_modules/@google-cloud/firestore-api | lockfile |
| @google-cloud/firestore | 9.3.1 | optional | pkg:npm/@google-cloud/firestore@9.3.1 | package-lock.json#node_modules/@google-cloud/firestore | lockfile |
| @google-cloud/paginator | 7.1.0 | optional | pkg:npm/@google-cloud/paginator@7.1.0 | package-lock.json#node_modules/@google-cloud/paginator | lockfile |
| @google-cloud/projectify | 6.1.0 | optional | pkg:npm/@google-cloud/projectify@6.1.0 | package-lock.json#node_modules/@google-cloud/projectify | lockfile |
| @google-cloud/promisify | 6.1.0 | optional | pkg:npm/@google-cloud/promisify@6.1.0 | package-lock.json#node_modules/@google-cloud/promisify | lockfile |
| @google-cloud/storage | 8.3.0 | optional | pkg:npm/@google-cloud/storage@8.3.0 | package-lock.json#node_modules/@google-cloud/storage | lockfile |
| @grpc/grpc-js | 1.14.5 | optional | pkg:npm/@grpc/grpc-js@1.14.5 | package-lock.json#node_modules/@grpc/grpc-js | lockfile |
| @grpc/proto-loader | 0.8.1 | optional | pkg:npm/@grpc/proto-loader@0.8.1 | package-lock.json#node_modules/@grpc/proto-loader | lockfile |
| @img/sharp-darwin-arm64 | 0.35.5 | optional | pkg:npm/@img/sharp-darwin-arm64@0.35.5 | package-lock.json#node_modules/@img/sharp-darwin-arm64 | lockfile |
| @img/sharp-darwin-x64 | 0.35.5 | optional | pkg:npm/@img/sharp-darwin-x64@0.35.5 | package-lock.json#node_modules/@img/sharp-darwin-x64 | lockfile |
| @img/sharp-freebsd-wasm32 | 0.35.5 | optional | pkg:npm/@img/sharp-freebsd-wasm32@0.35.5 | package-lock.json#node_modules/@img/sharp-freebsd-wasm32 | lockfile |
| @img/sharp-linux-arm | 0.35.5 | optional | pkg:npm/@img/sharp-linux-arm@0.35.5 | package-lock.json#node_modules/@img/sharp-linux-arm | lockfile |
| @img/sharp-linux-arm64 | 0.35.5 | optional | pkg:npm/@img/sharp-linux-arm64@0.35.5 | package-lock.json#node_modules/@img/sharp-linux-arm64 | lockfile |
| @img/sharp-linux-ppc64 | 0.35.5 | optional | pkg:npm/@img/sharp-linux-ppc64@0.35.5 | package-lock.json#node_modules/@img/sharp-linux-ppc64 | lockfile |
| @img/sharp-linux-riscv64 | 0.35.5 | optional | pkg:npm/@img/sharp-linux-riscv64@0.35.5 | package-lock.json#node_modules/@img/sharp-linux-riscv64 | lockfile |
| @img/sharp-linux-s390x | 0.35.5 | optional | pkg:npm/@img/sharp-linux-s390x@0.35.5 | package-lock.json#node_modules/@img/sharp-linux-s390x | lockfile |
| @img/sharp-linux-x64 | 0.35.5 | optional | pkg:npm/@img/sharp-linux-x64@0.35.5 | package-lock.json#node_modules/@img/sharp-linux-x64 | lockfile |
| @img/sharp-linuxmusl-arm64 | 0.35.5 | optional | pkg:npm/@img/sharp-linuxmusl-arm64@0.35.5 | package-lock.json#node_modules/@img/sharp-linuxmusl-arm64 | lockfile |
| @img/sharp-linuxmusl-x64 | 0.35.5 | optional | pkg:npm/@img/sharp-linuxmusl-x64@0.35.5 | package-lock.json#node_modules/@img/sharp-linuxmusl-x64 | lockfile |
| @img/sharp-webcontainers-wasm32 | 0.35.5 | optional | pkg:npm/@img/sharp-webcontainers-wasm32@0.35.5 | package-lock.json#node_modules/@img/sharp-webcontainers-wasm32 | lockfile |
| @opentelemetry/api | 1.9.1 | optional | pkg:npm/@opentelemetry/api@1.9.1 | package-lock.json#node_modules/@opentelemetry/api | lockfile |
| @playwright/test | 1.63.0 | optional | pkg:npm/@playwright/test@1.63.0 | package-lock.json#node_modules/@playwright/test | lockfile |
| @prisma/client | 5.22.0 | required | pkg:npm/@prisma/client@5.22.0 | package-lock.json#node_modules/@prisma/client | lockfile |
| @prisma/debug | 5.22.0 | optional | pkg:npm/@prisma/debug@5.22.0 | package-lock.json#node_modules/@prisma/debug | lockfile |
| @prisma/engines-version | 5.22.0-44.605197351a3c8bdd595af2d2a9bc3025bca48ea2 | optional | pkg:npm/@prisma/engines-version@5.22.0-44.605197351a3c8bdd595af2d2a9bc3025bca48ea2 | package-lock.json#node_modules/@prisma/engines-version | lockfile |
| @prisma/engines | 5.22.0 | optional | pkg:npm/@prisma/engines@5.22.0 | package-lock.json#node_modules/@prisma/engines | lockfile |
| @prisma/fetch-engine | 5.22.0 | optional | pkg:npm/@prisma/fetch-engine@5.22.0 | package-lock.json#node_modules/@prisma/fetch-engine | lockfile |
| @prisma/get-platform | 5.22.0 | optional | pkg:npm/@prisma/get-platform@5.22.0 | package-lock.json#node_modules/@prisma/get-platform | lockfile |
| @scarf/scarf | 1.4.0 | required | pkg:npm/@scarf/scarf@1.4.0 | package-lock.json#node_modules/@scarf/scarf | lockfile |
| @swc/helpers | 0.5.23 | required | pkg:npm/@swc/helpers@0.5.23 | package-lock.json#node_modules/@swc/helpers | lockfile |
| baseline-browser-mapping | 2.11.21 | required | pkg:npm/baseline-browser-mapping@2.11.21 | package-lock.json#node_modules/baseline-browser-mapping | lockfile |
| cluster-key-slot | 1.1.1 | required | pkg:npm/cluster-key-slot@1.1.1 | package-lock.json#node_modules/cluster-key-slot | lockfile |
| denque | 2.1.0 | required | pkg:npm/denque@2.1.0 | package-lock.json#node_modules/denque | lockfile |
| detect-libc | 2.1.2 | optional | pkg:npm/detect-libc@2.1.2 | package-lock.json#node_modules/detect-libc | lockfile |
| ecdsa-sig-formatter | 1.0.11 | required | pkg:npm/ecdsa-sig-formatter@1.0.11 | package-lock.json#node_modules/ecdsa-sig-formatter | lockfile |
| faye-websocket | 0.11.4 | optional | pkg:npm/faye-websocket@0.11.4 | package-lock.json#node_modules/faye-websocket | lockfile |
| firebase-admin | 14.4.0 | optional | pkg:npm/firebase-admin@14.4.0 | package-lock.json#node_modules/firebase-admin | lockfile |
| gaxios | 7.3.1 | optional | pkg:npm/gaxios@7.3.1 | package-lock.json#node_modules/gaxios | lockfile |
| gcp-metadata | 8.1.2 | optional | pkg:npm/gcp-metadata@8.1.2 | package-lock.json#node_modules/gcp-metadata | lockfile |
| gcp-metadata | 9.1.0 | optional | pkg:npm/gcp-metadata@9.1.0 | package-lock.json#node_modules/@google-cloud/storage/node_modules/gcp-metadata | lockfile |
| google-auth-library | 10.5.0 | optional | pkg:npm/google-auth-library@10.5.0 | package-lock.json#node_modules/@google-cloud/firestore-api/node_modules/google-auth-library | lockfile |
| google-auth-library | 10.9.1 | optional | pkg:npm/google-auth-library@10.9.1 | package-lock.json#node_modules/google-auth-library | lockfile |
| google-auth-library | 11.2.0 | optional | pkg:npm/google-auth-library@11.2.0 | package-lock.json#node_modules/google-gax/node_modules/google-auth-library | lockfile |
| google-gax | 5.0.8 | optional | pkg:npm/google-gax@5.0.8 | package-lock.json#node_modules/@google-cloud/firestore-api/node_modules/google-gax | lockfile |
| google-gax | 6.12.0 | optional | pkg:npm/google-gax@6.12.0 | package-lock.json#node_modules/google-gax | lockfile |
| google-logging-utils | 1.1.3 | optional | pkg:npm/google-logging-utils@1.1.3 | package-lock.json#node_modules/google-logging-utils | lockfile |
| google-logging-utils | 2.0.1 | optional | pkg:npm/google-logging-utils@2.0.1 | package-lock.json#node_modules/@google-cloud/storage/node_modules/google-logging-utils | lockfile |
| long | 5.3.2 | optional | pkg:npm/long@5.3.2 | package-lock.json#node_modules/long | lockfile |
| playwright-core | 1.63.0 | optional | pkg:npm/playwright-core@1.63.0 | package-lock.json#node_modules/playwright-core | lockfile |
| playwright | 1.63.0 | optional | pkg:npm/playwright@1.63.0 | package-lock.json#node_modules/playwright | lockfile |
| prisma | 5.22.0 | optional | pkg:npm/prisma@5.22.0 | package-lock.json#node_modules/prisma | lockfile |
| proto3-json-serializer | 3.0.4 | optional | pkg:npm/proto3-json-serializer@3.0.4 | package-lock.json#node_modules/@google-cloud/firestore-api/node_modules/proto3-json-serializer | lockfile |
| proto3-json-serializer | 4.0.2 | optional | pkg:npm/proto3-json-serializer@4.0.2 | package-lock.json#node_modules/proto3-json-serializer | lockfile |
| reflect-metadata | 0.2.2 | required | pkg:npm/reflect-metadata@0.2.2 | package-lock.json#node_modules/reflect-metadata | lockfile |
| rxjs | 7.8.1 | required | pkg:npm/rxjs@7.8.1 | package-lock.json#node_modules/rxjs | lockfile |
| rxjs | 7.8.2 | required | pkg:npm/rxjs@7.8.2 | package-lock.json#apps/api/node_modules/rxjs | lockfile |
| sharp | 0.35.5 | optional | pkg:npm/sharp@0.35.5 | package-lock.json#node_modules/sharp | lockfile |
| swagger-ui-dist | 5.32.13 | required | pkg:npm/swagger-ui-dist@5.32.13 | package-lock.json#node_modules/swagger-ui-dist | lockfile |
| teeny-request | 10.1.4 | optional | pkg:npm/teeny-request@10.1.4 | package-lock.json#node_modules/@google-cloud/firestore-api/node_modules/teeny-request | lockfile |
| teeny-request | 11.0.1 | optional | pkg:npm/teeny-request@11.0.1 | package-lock.json#node_modules/teeny-request | lockfile |
| websocket-driver | 0.7.5 | optional | pkg:npm/websocket-driver@0.7.5 | package-lock.json#node_modules/websocket-driver | lockfile |
| websocket-extensions | 0.1.4 | optional | pkg:npm/websocket-extensions@0.1.4 | package-lock.json#node_modules/websocket-extensions | lockfile |
| clock | 1.1.3 | required | pkg:pub/clock@1.1.3 | apps/mobile/pubspec.lock#clock | pub.dev archive SHA-256 verified by pubspec.lock for clock@1.1.3 |
| fake_async | 1.3.3 | required | pkg:pub/fake_async@1.3.3 | apps/mobile/pubspec.lock#fake_async | pub.dev archive SHA-256 verified by pubspec.lock for fake_async@1.3.3 |
| material_color_utilities | 0.13.0 | required | pkg:pub/material_color_utilities@0.13.0 | apps/mobile/pubspec.lock#material_color_utilities | pub.dev archive SHA-256 verified by pubspec.lock for material_color_utilities@0.13.0 |
| asyncpg | 0.29.0 | required | pkg:pypi/asyncpg@0.29.0 | services/trading-engine/requirements.txt | PyPI metadata asyncpg==0.29.0 |
| structlog | 24.4.0 | required | pkg:pypi/structlog@24.4.0 | services/trading-engine/requirements.txt | PyPI metadata structlog==24.4.0 |
| tenacity | 9.0.0 | required | pkg:pypi/tenacity@9.0.0 | services/trading-engine/requirements.txt | PyPI metadata tenacity==9.0.0 |

### Apache-2.0 AND ISC

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| ring | 0.17.14 | required | pkg:cargo/ring@0.17.14 | services/low-latency-gateway/Cargo.lock | crates.io version metadata ring@0.17.14 |

### Apache-2.0 AND LGPL-3.0-or-later

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| @img/sharp-win32-arm64 | 0.35.5 | optional | pkg:npm/@img/sharp-win32-arm64@0.35.5 | package-lock.json#node_modules/@img/sharp-win32-arm64 | lockfile |
| @img/sharp-win32-ia32 | 0.35.5 | optional | pkg:npm/@img/sharp-win32-ia32@0.35.5 | package-lock.json#node_modules/@img/sharp-win32-ia32 | lockfile |
| @img/sharp-win32-x64 | 0.35.5 | optional | pkg:npm/@img/sharp-win32-x64@0.35.5 | package-lock.json#node_modules/@img/sharp-win32-x64 | lockfile |

### Apache-2.0 AND LGPL-3.0-or-later AND MIT

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| @img/sharp-wasm32 | 0.35.5 | optional | pkg:npm/@img/sharp-wasm32@0.35.5 | package-lock.json#node_modules/@img/sharp-wasm32 | lockfile |

### Apache-2.0 OR ISC OR MIT

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| rustls | 0.23.45 | required | pkg:cargo/rustls@0.23.45 | services/low-latency-gateway/Cargo.lock | crates.io version metadata rustls@0.23.45 |

### Apache-2.0 OR MIT

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| idna_adapter | 1.2.2 | required | pkg:cargo/idna_adapter@1.2.2 | services/low-latency-gateway/Cargo.lock | crates.io version metadata idna_adapter@1.2.2 |
| pin-project-lite | 0.2.17 | required | pkg:cargo/pin-project-lite@0.2.17 | packages/sdk-rust/Cargo.lock | crates.io version metadata pin-project-lite@0.2.17 |
| utf8_iter | 1.0.4 | required | pkg:cargo/utf8_iter@1.0.4 | services/low-latency-gateway/Cargo.lock | crates.io version metadata utf8_iter@1.0.4 |
| uuid | 1.26.1 | required | pkg:cargo/uuid@1.26.1 | services/low-latency-gateway/Cargo.lock | crates.io version metadata uuid@1.26.1 |
| zeroize | 1.9.0 | required | pkg:cargo/zeroize@1.9.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata zeroize@1.9.0 |

### Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| wasi | 0.11.1+wasi-snapshot-preview1 | required | pkg:cargo/wasi@0.11.1+wasi-snapshot-preview1 | packages/sdk-rust/Cargo.lock | crates.io version metadata wasi@0.11.1+wasi-snapshot-preview1 |

### BlueOak-1.0.0

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| jackspeak | 3.4.3 | optional | pkg:npm/jackspeak@3.4.3 | package-lock.json#node_modules/jackspeak | lockfile |
| lru-cache | 11.5.3 | optional | pkg:npm/lru-cache@11.5.3 | package-lock.json#node_modules/jwks-rsa/node_modules/lru-cache | lockfile |
| minipass | 7.1.3 | optional | pkg:npm/minipass@7.1.3 | package-lock.json#node_modules/minipass | lockfile |
| package-json-from-dist | 1.0.1 | optional | pkg:npm/package-json-from-dist@1.0.1 | package-lock.json#node_modules/package-json-from-dist | lockfile |
| path-scurry | 1.11.1 | optional | pkg:npm/path-scurry@1.11.1 | package-lock.json#node_modules/path-scurry | lockfile |
| sax | 1.6.1 | required | pkg:npm/sax@1.6.1 | package-lock.json#node_modules/sax | lockfile |

### BSD-2-Clause

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| dotenv-expand | 12.0.3 | required | pkg:npm/dotenv-expand@12.0.3 | package-lock.json#node_modules/@nestjs/config/node_modules/dotenv-expand | lockfile |
| dotenv | 16.6.1 | required | pkg:npm/dotenv@16.6.1 | package-lock.json#node_modules/@nestjs/config/node_modules/dotenv-expand/node_modules/dotenv | lockfile |
| dotenv | 17.4.1 | required | pkg:npm/dotenv@17.4.1 | package-lock.json#node_modules/@nestjs/config/node_modules/dotenv | lockfile |
| python-json-logger | 2.0.7 | required | pkg:pypi/python-json-logger@2.0.7 | services/trading-engine/requirements.txt | PyPI source archive verified by its JSON digest for python-json-logger==2.0.7 |

### BSD-2-Clause OR Apache-2.0 OR MIT

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| zerocopy-derive | 0.8.57 | required | pkg:cargo/zerocopy-derive@0.8.57 | services/low-latency-gateway/Cargo.lock | crates.io version metadata zerocopy-derive@0.8.57 |
| zerocopy | 0.8.57 | required | pkg:cargo/zerocopy@0.8.57 | services/low-latency-gateway/Cargo.lock | crates.io version metadata zerocopy@0.8.57 |

### BSD-3-Clause

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| subtle | 2.6.1 | required | pkg:cargo/subtle@2.6.1 | services/low-latency-gateway/Cargo.lock | crates.io version metadata subtle@2.6.1 |
| @protobufjs/aspromise | 1.1.2 | optional | pkg:npm/@protobufjs/aspromise@1.1.2 | package-lock.json#node_modules/@protobufjs/aspromise | lockfile |
| @protobufjs/base64 | 1.1.2 | optional | pkg:npm/@protobufjs/base64@1.1.2 | package-lock.json#node_modules/@protobufjs/base64 | lockfile |
| @protobufjs/codegen | 2.0.5 | optional | pkg:npm/@protobufjs/codegen@2.0.5 | package-lock.json#node_modules/@protobufjs/codegen | lockfile |
| @protobufjs/eventemitter | 1.1.1 | optional | pkg:npm/@protobufjs/eventemitter@1.1.1 | package-lock.json#node_modules/@protobufjs/eventemitter | lockfile |
| @protobufjs/fetch | 1.1.1 | optional | pkg:npm/@protobufjs/fetch@1.1.1 | package-lock.json#node_modules/@protobufjs/fetch | lockfile |
| @protobufjs/float | 1.0.2 | optional | pkg:npm/@protobufjs/float@1.0.2 | package-lock.json#node_modules/@protobufjs/float | lockfile |
| @protobufjs/path | 1.1.2 | optional | pkg:npm/@protobufjs/path@1.1.2 | package-lock.json#node_modules/@protobufjs/path | lockfile |
| @protobufjs/pool | 1.1.0 | optional | pkg:npm/@protobufjs/pool@1.1.0 | package-lock.json#node_modules/@protobufjs/pool | lockfile |
| @protobufjs/utf8 | 1.1.2 | optional | pkg:npm/@protobufjs/utf8@1.1.2 | package-lock.json#node_modules/@protobufjs/utf8 | lockfile |
| buffer-equal-constant-time | 1.0.1 | required | pkg:npm/buffer-equal-constant-time@1.0.1 | package-lock.json#node_modules/buffer-equal-constant-time | lockfile |
| ieee754 | 1.2.1 | required | pkg:npm/ieee754@1.2.1 | package-lock.json#node_modules/ieee754 | lockfile |
| protobufjs | 7.6.6 | optional | pkg:npm/protobufjs@7.6.6 | package-lock.json#node_modules/protobufjs | lockfile |
| qs | 6.16.0 | required | pkg:npm/qs@6.16.0 | package-lock.json#node_modules/qs | lockfile |
| source-map-js | 1.2.2 | required | pkg:npm/source-map-js@1.2.2 | package-lock.json#node_modules/source-map-js | lockfile |
| async | 2.11.0 | required | pkg:pub/async@2.11.0 | apps/mobile/pubspec.lock#async | pub.dev archive SHA-256 verified by pubspec.lock for async@2.11.0 |
| boolean_selector | 2.1.1 | required | pkg:pub/boolean_selector@2.1.1 | apps/mobile/pubspec.lock#boolean_selector | pub.dev archive SHA-256 verified by pubspec.lock for boolean_selector@2.1.1 |
| characters | 1.4.1 | required | pkg:pub/characters@1.4.1 | apps/mobile/pubspec.lock#characters | pub.dev archive SHA-256 verified by pubspec.lock for characters@1.4.1 |
| collection | 1.19.1 | required | pkg:pub/collection@1.19.1 | apps/mobile/pubspec.lock#collection | pub.dev archive SHA-256 verified by pubspec.lock for collection@1.19.1 |
| crypto | 3.0.7 | required | pkg:pub/crypto@3.0.7 | apps/mobile/pubspec.lock#crypto | pub.dev archive SHA-256 verified by pubspec.lock for crypto@3.0.7 |
| device_info_plus_platform_interface | 7.0.2 | required | pkg:pub/device_info_plus_platform_interface@7.0.2 | apps/mobile/pubspec.lock#device_info_plus_platform_interface | pub.dev archive SHA-256 verified by pubspec.lock for device_info_plus_platform_interface@7.0.2 |
| device_info_plus | 10.1.2 | required | pkg:pub/device_info_plus@10.1.2 | apps/mobile/pubspec.lock#device_info_plus | pub.dev archive SHA-256 verified by pubspec.lock for device_info_plus@10.1.2 |
| ffi | 2.1.3 | required | pkg:pub/ffi@2.1.3 | apps/mobile/pubspec.lock#ffi | pub.dev archive SHA-256 verified by pubspec.lock for ffi@2.1.3 |
| file | 7.0.1 | required | pkg:pub/file@7.0.1 | apps/mobile/pubspec.lock#file | pub.dev archive SHA-256 verified by pubspec.lock for file@7.0.1 |
| fixnum | 1.1.1 | required | pkg:pub/fixnum@1.1.1 | apps/mobile/pubspec.lock#fixnum | pub.dev archive SHA-256 verified by pubspec.lock for fixnum@1.1.1 |
| flutter_secure_storage_linux | 1.2.3 | required | pkg:pub/flutter_secure_storage_linux@1.2.3 | apps/mobile/pubspec.lock#flutter_secure_storage_linux | pub.dev archive SHA-256 verified by pubspec.lock for flutter_secure_storage_linux@1.2.3 |
| flutter_secure_storage_macos | 3.1.3 | required | pkg:pub/flutter_secure_storage_macos@3.1.3 | apps/mobile/pubspec.lock#flutter_secure_storage_macos | pub.dev archive SHA-256 verified by pubspec.lock for flutter_secure_storage_macos@3.1.3 |
| flutter_secure_storage_platform_interface | 1.1.2 | required | pkg:pub/flutter_secure_storage_platform_interface@1.1.2 | apps/mobile/pubspec.lock#flutter_secure_storage_platform_interface | pub.dev archive SHA-256 verified by pubspec.lock for flutter_secure_storage_platform_interface@1.1.2 |
| flutter_secure_storage_web | 1.2.1 | required | pkg:pub/flutter_secure_storage_web@1.2.1 | apps/mobile/pubspec.lock#flutter_secure_storage_web | pub.dev archive SHA-256 verified by pubspec.lock for flutter_secure_storage_web@1.2.1 |
| flutter_secure_storage_windows | 3.1.2 | required | pkg:pub/flutter_secure_storage_windows@3.1.2 | apps/mobile/pubspec.lock#flutter_secure_storage_windows | pub.dev archive SHA-256 verified by pubspec.lock for flutter_secure_storage_windows@3.1.2 |
| flutter_secure_storage | 9.2.4 | required | pkg:pub/flutter_secure_storage@9.2.4 | apps/mobile/pubspec.lock#flutter_secure_storage | pub.dev archive SHA-256 verified by pubspec.lock for flutter_secure_storage@9.2.4 |
| go_router | 14.8.1 | required | pkg:pub/go_router@14.8.1 | apps/mobile/pubspec.lock#go_router | pub.dev archive SHA-256 verified by pubspec.lock for go_router@14.8.1 |
| http_parser | 4.0.2 | required | pkg:pub/http_parser@4.0.2 | apps/mobile/pubspec.lock#http_parser | pub.dev archive SHA-256 verified by pubspec.lock for http_parser@4.0.2 |
| http | 1.6.0 | required | pkg:pub/http@1.6.0 | apps/mobile/pubspec.lock#http | pub.dev archive SHA-256 verified by pubspec.lock for http@1.6.0 |
| intl | 0.20.3 | required | pkg:pub/intl@0.20.3 | apps/mobile/pubspec.lock#intl | pub.dev archive SHA-256 verified by pubspec.lock for intl@0.20.3 |
| js | 0.6.7 | required | pkg:pub/js@0.6.7 | apps/mobile/pubspec.lock#js | pub.dev archive SHA-256 verified by pubspec.lock for js@0.6.7 |
| leak_tracker_flutter_testing | 3.0.10 | required | pkg:pub/leak_tracker_flutter_testing@3.0.10 | apps/mobile/pubspec.lock#leak_tracker_flutter_testing | pub.dev archive SHA-256 verified by pubspec.lock for leak_tracker_flutter_testing@3.0.10 |
| leak_tracker_testing | 3.0.2 | required | pkg:pub/leak_tracker_testing@3.0.2 | apps/mobile/pubspec.lock#leak_tracker_testing | pub.dev archive SHA-256 verified by pubspec.lock for leak_tracker_testing@3.0.2 |
| leak_tracker | 11.0.2 | required | pkg:pub/leak_tracker@11.0.2 | apps/mobile/pubspec.lock#leak_tracker | pub.dev archive SHA-256 verified by pubspec.lock for leak_tracker@11.0.2 |
| lints | 4.0.0 | required | pkg:pub/lints@4.0.0 | apps/mobile/pubspec.lock#lints | pub.dev archive SHA-256 verified by pubspec.lock for lints@4.0.0 |
| logging | 1.3.0 | required | pkg:pub/logging@1.3.0 | apps/mobile/pubspec.lock#logging | pub.dev archive SHA-256 verified by pubspec.lock for logging@1.3.0 |
| matcher | 0.12.20 | required | pkg:pub/matcher@0.12.20 | apps/mobile/pubspec.lock#matcher | pub.dev archive SHA-256 verified by pubspec.lock for matcher@0.12.20 |
| meta | 1.19.0 | required | pkg:pub/meta@1.19.0 | apps/mobile/pubspec.lock#meta | pub.dev archive SHA-256 verified by pubspec.lock for meta@1.19.0 |
| mime | 2.1.0 | required | pkg:pub/mime@2.1.0 | apps/mobile/pubspec.lock#mime | pub.dev archive SHA-256 verified by pubspec.lock for mime@2.1.0 |
| package_info_plus_platform_interface | 3.2.1 | required | pkg:pub/package_info_plus_platform_interface@3.2.1 | apps/mobile/pubspec.lock#package_info_plus_platform_interface | pub.dev archive SHA-256 verified by pubspec.lock for package_info_plus_platform_interface@3.2.1 |
| package_info_plus | 8.3.1 | required | pkg:pub/package_info_plus@8.3.1 | apps/mobile/pubspec.lock#package_info_plus | pub.dev archive SHA-256 verified by pubspec.lock for package_info_plus@8.3.1 |
| path_provider_android | 2.2.15 | required | pkg:pub/path_provider_android@2.2.15 | apps/mobile/pubspec.lock#path_provider_android | pub.dev archive SHA-256 verified by pubspec.lock for path_provider_android@2.2.15 |
| path_provider_foundation | 2.4.1 | required | pkg:pub/path_provider_foundation@2.4.1 | apps/mobile/pubspec.lock#path_provider_foundation | pub.dev archive SHA-256 verified by pubspec.lock for path_provider_foundation@2.4.1 |
| path_provider_linux | 2.2.1 | required | pkg:pub/path_provider_linux@2.2.1 | apps/mobile/pubspec.lock#path_provider_linux | pub.dev archive SHA-256 verified by pubspec.lock for path_provider_linux@2.2.1 |
| path_provider_platform_interface | 2.1.2 | required | pkg:pub/path_provider_platform_interface@2.1.2 | apps/mobile/pubspec.lock#path_provider_platform_interface | pub.dev archive SHA-256 verified by pubspec.lock for path_provider_platform_interface@2.1.2 |
| path_provider_windows | 2.3.0 | required | pkg:pub/path_provider_windows@2.3.0 | apps/mobile/pubspec.lock#path_provider_windows | pub.dev archive SHA-256 verified by pubspec.lock for path_provider_windows@2.3.0 |
| path_provider | 2.1.5 | required | pkg:pub/path_provider@2.1.5 | apps/mobile/pubspec.lock#path_provider | pub.dev archive SHA-256 verified by pubspec.lock for path_provider@2.1.5 |
| path | 1.9.1 | required | pkg:pub/path@1.9.1 | apps/mobile/pubspec.lock#path | pub.dev archive SHA-256 verified by pubspec.lock for path@1.9.1 |
| platform | 3.1.6 | required | pkg:pub/platform@3.1.6 | apps/mobile/pubspec.lock#platform | pub.dev archive SHA-256 verified by pubspec.lock for platform@3.1.6 |
| plugin_platform_interface | 2.1.8 | required | pkg:pub/plugin_platform_interface@2.1.8 | apps/mobile/pubspec.lock#plugin_platform_interface | pub.dev archive SHA-256 verified by pubspec.lock for plugin_platform_interface@2.1.8 |
| shared_preferences_android | 2.4.7 | required | pkg:pub/shared_preferences_android@2.4.7 | apps/mobile/pubspec.lock#shared_preferences_android | pub.dev archive SHA-256 verified by pubspec.lock for shared_preferences_android@2.4.7 |
| shared_preferences_foundation | 2.5.4 | required | pkg:pub/shared_preferences_foundation@2.5.4 | apps/mobile/pubspec.lock#shared_preferences_foundation | pub.dev archive SHA-256 verified by pubspec.lock for shared_preferences_foundation@2.5.4 |
| shared_preferences_linux | 2.4.1 | required | pkg:pub/shared_preferences_linux@2.4.1 | apps/mobile/pubspec.lock#shared_preferences_linux | pub.dev archive SHA-256 verified by pubspec.lock for shared_preferences_linux@2.4.1 |
| shared_preferences_platform_interface | 2.4.1 | required | pkg:pub/shared_preferences_platform_interface@2.4.1 | apps/mobile/pubspec.lock#shared_preferences_platform_interface | pub.dev archive SHA-256 verified by pubspec.lock for shared_preferences_platform_interface@2.4.1 |
| shared_preferences_web | 2.4.3 | required | pkg:pub/shared_preferences_web@2.4.3 | apps/mobile/pubspec.lock#shared_preferences_web | pub.dev archive SHA-256 verified by pubspec.lock for shared_preferences_web@2.4.3 |
| shared_preferences_windows | 2.4.1 | required | pkg:pub/shared_preferences_windows@2.4.1 | apps/mobile/pubspec.lock#shared_preferences_windows | pub.dev archive SHA-256 verified by pubspec.lock for shared_preferences_windows@2.4.1 |
| shared_preferences | 2.5.3 | required | pkg:pub/shared_preferences@2.5.3 | apps/mobile/pubspec.lock#shared_preferences | pub.dev archive SHA-256 verified by pubspec.lock for shared_preferences@2.5.3 |
| source_span | 1.10.0 | required | pkg:pub/source_span@1.10.0 | apps/mobile/pubspec.lock#source_span | pub.dev archive SHA-256 verified by pubspec.lock for source_span@1.10.0 |
| stack_trace | 1.12.2 | required | pkg:pub/stack_trace@1.12.2 | apps/mobile/pubspec.lock#stack_trace | pub.dev archive SHA-256 verified by pubspec.lock for stack_trace@1.12.2 |
| stream_channel | 2.1.4 | required | pkg:pub/stream_channel@2.1.4 | apps/mobile/pubspec.lock#stream_channel | pub.dev archive SHA-256 verified by pubspec.lock for stream_channel@2.1.4 |
| string_scanner | 1.2.0 | required | pkg:pub/string_scanner@1.2.0 | apps/mobile/pubspec.lock#string_scanner | pub.dev archive SHA-256 verified by pubspec.lock for string_scanner@1.2.0 |
| term_glyph | 1.2.1 | required | pkg:pub/term_glyph@1.2.1 | apps/mobile/pubspec.lock#term_glyph | pub.dev archive SHA-256 verified by pubspec.lock for term_glyph@1.2.1 |
| test_api | 0.7.12 | required | pkg:pub/test_api@0.7.12 | apps/mobile/pubspec.lock#test_api | pub.dev archive SHA-256 verified by pubspec.lock for test_api@0.7.12 |
| typed_data | 1.4.0 | required | pkg:pub/typed_data@1.4.0 | apps/mobile/pubspec.lock#typed_data | pub.dev archive SHA-256 verified by pubspec.lock for typed_data@1.4.0 |
| vector_math | 2.4.3 | required | pkg:pub/vector_math@2.4.3 | apps/mobile/pubspec.lock#vector_math | pub.dev archive SHA-256 verified by pubspec.lock for vector_math@2.4.3 |
| vm_service | 14.2.5 | required | pkg:pub/vm_service@14.2.5 | apps/mobile/pubspec.lock#vm_service | pub.dev archive SHA-256 verified by pubspec.lock for vm_service@14.2.5 |
| web | 1.1.1 | required | pkg:pub/web@1.1.1 | apps/mobile/pubspec.lock#web | pub.dev archive SHA-256 verified by pubspec.lock for web@1.1.1 |
| win32_registry | 1.1.5 | required | pkg:pub/win32_registry@1.1.5 | apps/mobile/pubspec.lock#win32_registry | pub.dev archive SHA-256 verified by pubspec.lock for win32_registry@1.1.5 |
| win32 | 5.10.1 | required | pkg:pub/win32@5.10.1 | apps/mobile/pubspec.lock#win32 | pub.dev archive SHA-256 verified by pubspec.lock for win32@5.10.1 |
| xdg_directories | 1.1.0 | required | pkg:pub/xdg_directories@1.1.0 | apps/mobile/pubspec.lock#xdg_directories | pub.dev archive SHA-256 verified by pubspec.lock for xdg_directories@1.1.0 |
| httpx | 0.27.2 | required | pkg:pypi/httpx@0.27.2 | services/trading-engine/requirements.txt | PyPI source archive verified by its JSON digest for httpx==0.27.2 |
| starlette | 1.7.0 | required | pkg:pypi/starlette@1.7.0 | services/execution-engine/requirements.txt | PyPI metadata starlette==1.7.0 |
| uvicorn | 0.31.0 | required | pkg:pypi/uvicorn@0.31.0 | services/trading-engine/requirements.txt | PyPI source archive verified by its JSON digest for uvicorn==0.31.0 |
| websockets | 13.1 | required | pkg:pypi/websockets@13.1 | services/market-data/requirements.txt | PyPI metadata websockets==13.1 |

### CC-BY-4.0

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| caniuse-lite | 1.0.30001810 | required | pkg:npm/caniuse-lite@1.0.30001810 | package-lock.json#node_modules/caniuse-lite | lockfile |

### CDLA-Permissive-2.0

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| webpki-roots | 0.26.11 | required | pkg:cargo/webpki-roots@0.26.11 | services/low-latency-gateway/Cargo.lock | crates.io version metadata webpki-roots@0.26.11 |
| webpki-roots | 1.0.9 | required | pkg:cargo/webpki-roots@1.0.9 | services/low-latency-gateway/Cargo.lock | crates.io version metadata webpki-roots@1.0.9 |

### ISC

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| rustls-webpki | 0.103.15 | required | pkg:cargo/rustls-webpki@0.103.15 | services/low-latency-gateway/Cargo.lock | crates.io version metadata rustls-webpki@0.103.15 |
| untrusted | 0.9.0 | required | pkg:cargo/untrusted@0.9.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata untrusted@0.9.0 |
| @isaacs/cliui | 8.0.2 | optional | pkg:npm/@isaacs/cliui@8.0.2 | package-lock.json#node_modules/@isaacs/cliui | lockfile |
| ansi-align | 3.0.1 | required | pkg:npm/ansi-align@3.0.1 | package-lock.json#node_modules/ansi-align | lockfile |
| cliui | 6.0.0 | required | pkg:npm/cliui@6.0.0 | package-lock.json#node_modules/qrcode/node_modules/cliui | lockfile |
| cliui | 8.0.1 | optional | pkg:npm/cliui@8.0.1 | package-lock.json#node_modules/cliui | lockfile |
| foreground-child | 3.3.1 | optional | pkg:npm/foreground-child@3.3.1 | package-lock.json#node_modules/foreground-child | lockfile |
| get-caller-file | 2.0.5 | required | pkg:npm/get-caller-file@2.0.5 | package-lock.json#node_modules/get-caller-file | lockfile |
| glob | 10.5.0 | optional | pkg:npm/glob@10.5.0 | package-lock.json#node_modules/glob | lockfile |
| inherits | 2.0.4 | required | pkg:npm/inherits@2.0.4 | package-lock.json#node_modules/inherits | lockfile |
| isexe | 2.0.0 | optional | pkg:npm/isexe@2.0.0 | package-lock.json#node_modules/isexe | lockfile |
| iterare | 1.2.1 | required | pkg:npm/iterare@1.2.1 | package-lock.json#node_modules/iterare | lockfile |
| lru-cache | 10.4.3 | optional | pkg:npm/lru-cache@10.4.3 | package-lock.json#node_modules/lru-cache | lockfile |
| minimatch | 9.0.9 | optional | pkg:npm/minimatch@9.0.9 | package-lock.json#node_modules/minimatch | lockfile |
| once | 1.4.0 | required | pkg:npm/once@1.4.0 | package-lock.json#node_modules/once | lockfile |
| picocolors | 1.1.1 | required | pkg:npm/picocolors@1.1.1 | package-lock.json#node_modules/picocolors | lockfile |
| require-main-filename | 2.0.0 | required | pkg:npm/require-main-filename@2.0.0 | package-lock.json#node_modules/require-main-filename | lockfile |
| rimraf | 5.0.10 | optional | pkg:npm/rimraf@5.0.10 | package-lock.json#node_modules/rimraf | lockfile |
| semver | 7.8.5 | required | pkg:npm/semver@7.8.5 | package-lock.json#node_modules/semver | lockfile |
| set-blocking | 2.0.0 | required | pkg:npm/set-blocking@2.0.0 | package-lock.json#node_modules/set-blocking | lockfile |
| setprototypeof | 1.2.0 | required | pkg:npm/setprototypeof@1.2.0 | package-lock.json#node_modules/setprototypeof | lockfile |
| signal-exit | 4.1.0 | optional | pkg:npm/signal-exit@4.1.0 | package-lock.json#node_modules/signal-exit | lockfile |
| split2 | 4.2.0 | required | pkg:npm/split2@4.2.0 | package-lock.json#node_modules/split2 | lockfile |
| which-module | 2.0.1 | required | pkg:npm/which-module@2.0.1 | package-lock.json#node_modules/which-module | lockfile |
| which | 2.0.2 | optional | pkg:npm/which@2.0.2 | package-lock.json#node_modules/which | lockfile |
| wrappy | 1.0.2 | required | pkg:npm/wrappy@1.0.2 | package-lock.json#node_modules/wrappy | lockfile |
| y18n | 4.0.3 | required | pkg:npm/y18n@4.0.3 | package-lock.json#node_modules/qrcode/node_modules/y18n | lockfile |
| y18n | 5.0.8 | optional | pkg:npm/y18n@5.0.8 | package-lock.json#node_modules/y18n | lockfile |
| yargs-parser | 18.1.3 | required | pkg:npm/yargs-parser@18.1.3 | package-lock.json#node_modules/qrcode/node_modules/yargs-parser | lockfile |
| yargs-parser | 21.1.1 | optional | pkg:npm/yargs-parser@21.1.1 | package-lock.json#node_modules/yargs-parser | lockfile |

### LGPL-3.0-or-later

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| @img/sharp-libvips-darwin-arm64 | 1.3.4 | optional | pkg:npm/@img/sharp-libvips-darwin-arm64@1.3.4 | package-lock.json#node_modules/@img/sharp-libvips-darwin-arm64 | lockfile |
| @img/sharp-libvips-darwin-x64 | 1.3.4 | optional | pkg:npm/@img/sharp-libvips-darwin-x64@1.3.4 | package-lock.json#node_modules/@img/sharp-libvips-darwin-x64 | lockfile |
| @img/sharp-libvips-linux-arm | 1.3.4 | optional | pkg:npm/@img/sharp-libvips-linux-arm@1.3.4 | package-lock.json#node_modules/@img/sharp-libvips-linux-arm | lockfile |
| @img/sharp-libvips-linux-arm64 | 1.3.4 | optional | pkg:npm/@img/sharp-libvips-linux-arm64@1.3.4 | package-lock.json#node_modules/@img/sharp-libvips-linux-arm64 | lockfile |
| @img/sharp-libvips-linux-ppc64 | 1.3.4 | optional | pkg:npm/@img/sharp-libvips-linux-ppc64@1.3.4 | package-lock.json#node_modules/@img/sharp-libvips-linux-ppc64 | lockfile |
| @img/sharp-libvips-linux-riscv64 | 1.3.4 | optional | pkg:npm/@img/sharp-libvips-linux-riscv64@1.3.4 | package-lock.json#node_modules/@img/sharp-libvips-linux-riscv64 | lockfile |
| @img/sharp-libvips-linux-s390x | 1.3.4 | optional | pkg:npm/@img/sharp-libvips-linux-s390x@1.3.4 | package-lock.json#node_modules/@img/sharp-libvips-linux-s390x | lockfile |
| @img/sharp-libvips-linux-x64 | 1.3.4 | optional | pkg:npm/@img/sharp-libvips-linux-x64@1.3.4 | package-lock.json#node_modules/@img/sharp-libvips-linux-x64 | lockfile |
| @img/sharp-libvips-linuxmusl-arm64 | 1.3.4 | optional | pkg:npm/@img/sharp-libvips-linuxmusl-arm64@1.3.4 | package-lock.json#node_modules/@img/sharp-libvips-linuxmusl-arm64 | lockfile |
| @img/sharp-libvips-linuxmusl-x64 | 1.3.4 | optional | pkg:npm/@img/sharp-libvips-linuxmusl-x64@1.3.4 | package-lock.json#node_modules/@img/sharp-libvips-linuxmusl-x64 | lockfile |

### MIT

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| bytes | 1.12.1 | required | pkg:cargo/bytes@1.12.1 | services/low-latency-gateway/Cargo.lock | crates.io version metadata bytes@1.12.1 |
| data-encoding | 2.11.1 | required | pkg:cargo/data-encoding@2.11.1 | services/low-latency-gateway/Cargo.lock | crates.io version metadata data-encoding@2.11.1 |
| generic-array | 0.14.7 | required | pkg:cargo/generic-array@0.14.7 | services/low-latency-gateway/Cargo.lock | crates.io version metadata generic-array@0.14.7 |
| matchers | 0.2.0 | required | pkg:cargo/matchers@0.2.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata matchers@0.2.0 |
| mio | 1.2.3 | required | pkg:cargo/mio@1.2.3 | packages/sdk-rust/Cargo.lock | crates.io version metadata mio@1.2.3 |
| nu-ansi-term | 0.50.3 | required | pkg:cargo/nu-ansi-term@0.50.3 | services/low-latency-gateway/Cargo.lock | crates.io version metadata nu-ansi-term@0.50.3 |
| redox_syscall | 0.5.18 | required | pkg:cargo/redox_syscall@0.5.18 | packages/sdk-rust/Cargo.lock | crates.io version metadata redox_syscall@0.5.18 |
| sharded-slab | 0.1.7 | required | pkg:cargo/sharded-slab@0.1.7 | services/low-latency-gateway/Cargo.lock | crates.io version metadata sharded-slab@0.1.7 |
| slab | 0.4.12 | required | pkg:cargo/slab@0.4.12 | services/low-latency-gateway/Cargo.lock | crates.io version metadata slab@0.4.12 |
| synstructure | 0.14.0 | required | pkg:cargo/synstructure@0.14.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata synstructure@0.14.0 |
| tokio-macros | 2.7.2 | required | pkg:cargo/tokio-macros@2.7.2 | services/low-latency-gateway/Cargo.lock | crates.io version metadata tokio-macros@2.7.2 |
| tokio-tungstenite | 0.24.0 | required | pkg:cargo/tokio-tungstenite@0.24.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata tokio-tungstenite@0.24.0 |
| tokio | 1.53.1 | required | pkg:cargo/tokio@1.53.1 | services/low-latency-gateway/Cargo.lock | crates.io version metadata tokio@1.53.1 |
| tracing-attributes | 0.1.31 | required | pkg:cargo/tracing-attributes@0.1.31 | services/low-latency-gateway/Cargo.lock | crates.io version metadata tracing-attributes@0.1.31 |
| tracing-core | 0.1.36 | required | pkg:cargo/tracing-core@0.1.36 | services/low-latency-gateway/Cargo.lock | crates.io version metadata tracing-core@0.1.36 |
| tracing-log | 0.2.0 | required | pkg:cargo/tracing-log@0.2.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata tracing-log@0.2.0 |
| tracing-subscriber | 0.3.23 | required | pkg:cargo/tracing-subscriber@0.3.23 | services/low-latency-gateway/Cargo.lock | crates.io version metadata tracing-subscriber@0.3.23 |
| tracing | 0.1.44 | required | pkg:cargo/tracing@0.1.44 | services/low-latency-gateway/Cargo.lock | crates.io version metadata tracing@0.1.44 |
| valuable | 0.1.1 | required | pkg:cargo/valuable@0.1.1 | services/low-latency-gateway/Cargo.lock | crates.io version metadata valuable@0.1.1 |
| zmij | 1.0.23 | required | pkg:cargo/zmij@1.0.23 | packages/sdk-rust/Cargo.lock | crates.io version metadata zmij@1.0.23 |
| @borewit/text-codec | 0.2.2 | required | pkg:npm/@borewit/text-codec@0.2.2 | package-lock.json#node_modules/@borewit/text-codec | lockfile |
| @emnapi/runtime | 1.11.3 | optional | pkg:npm/@emnapi/runtime@1.11.3 | package-lock.json#node_modules/@img/sharp-wasm32/node_modules/@emnapi/runtime | lockfile |
| @fastify/busboy | 3.2.2 | optional | pkg:npm/@fastify/busboy@3.2.2 | package-lock.json#node_modules/@fastify/busboy | lockfile |
| @img/colour | 1.1.0 | optional | pkg:npm/@img/colour@1.1.0 | package-lock.json#node_modules/@img/colour | lockfile |
| @ioredis/commands | 1.10.0 | required | pkg:npm/@ioredis/commands@1.10.0 | package-lock.json#node_modules/@ioredis/commands | lockfile |
| @js-sdsl/ordered-map | 4.4.2 | optional | pkg:npm/@js-sdsl/ordered-map@4.4.2 | package-lock.json#node_modules/@js-sdsl/ordered-map | lockfile |
| @lukeed/csprng | 1.1.0 | required | pkg:npm/@lukeed/csprng@1.1.0 | package-lock.json#node_modules/@lukeed/csprng | lockfile |
| @microsoft/tsdoc | 0.16.0 | required | pkg:npm/@microsoft/tsdoc@0.16.0 | package-lock.json#node_modules/@microsoft/tsdoc | lockfile |
| @msgpackr-extract/msgpackr-extract-darwin-arm64 | 3.0.4 | optional | pkg:npm/@msgpackr-extract/msgpackr-extract-darwin-arm64@3.0.4 | package-lock.json#node_modules/@msgpackr-extract/msgpackr-extract-darwin-arm64 | lockfile |
| @msgpackr-extract/msgpackr-extract-darwin-x64 | 3.0.4 | optional | pkg:npm/@msgpackr-extract/msgpackr-extract-darwin-x64@3.0.4 | package-lock.json#node_modules/@msgpackr-extract/msgpackr-extract-darwin-x64 | lockfile |
| @msgpackr-extract/msgpackr-extract-linux-arm | 3.0.4 | optional | pkg:npm/@msgpackr-extract/msgpackr-extract-linux-arm@3.0.4 | package-lock.json#node_modules/@msgpackr-extract/msgpackr-extract-linux-arm | lockfile |
| @msgpackr-extract/msgpackr-extract-linux-arm64 | 3.0.4 | optional | pkg:npm/@msgpackr-extract/msgpackr-extract-linux-arm64@3.0.4 | package-lock.json#node_modules/@msgpackr-extract/msgpackr-extract-linux-arm64 | lockfile |
| @msgpackr-extract/msgpackr-extract-linux-x64 | 3.0.4 | optional | pkg:npm/@msgpackr-extract/msgpackr-extract-linux-x64@3.0.4 | package-lock.json#node_modules/@msgpackr-extract/msgpackr-extract-linux-x64 | lockfile |
| @msgpackr-extract/msgpackr-extract-win32-x64 | 3.0.4 | optional | pkg:npm/@msgpackr-extract/msgpackr-extract-win32-x64@3.0.4 | package-lock.json#node_modules/@msgpackr-extract/msgpackr-extract-win32-x64 | lockfile |
| @nestjs/bull-shared | 11.0.5 | required | pkg:npm/@nestjs/bull-shared@11.0.5 | package-lock.json#node_modules/@nestjs/bull-shared | lockfile |
| @nestjs/bullmq | 11.0.5 | required | pkg:npm/@nestjs/bullmq@11.0.5 | package-lock.json#node_modules/@nestjs/bullmq | lockfile |
| @nestjs/common | 11.2.7 | required | pkg:npm/@nestjs/common@11.2.7 | package-lock.json#node_modules/@nestjs/common | lockfile |
| @nestjs/config | 4.0.4 | required | pkg:npm/@nestjs/config@4.0.4 | package-lock.json#node_modules/@nestjs/config | lockfile |
| @nestjs/core | 11.2.7 | required | pkg:npm/@nestjs/core@11.2.7 | package-lock.json#node_modules/@nestjs/core | lockfile |
| @nestjs/jwt | 11.0.2 | required | pkg:npm/@nestjs/jwt@11.0.2 | package-lock.json#node_modules/@nestjs/jwt | lockfile |
| @nestjs/mapped-types | 2.1.1 | required | pkg:npm/@nestjs/mapped-types@2.1.1 | package-lock.json#node_modules/@nestjs/mapped-types | lockfile |
| @nestjs/passport | 11.0.5 | required | pkg:npm/@nestjs/passport@11.0.5 | package-lock.json#node_modules/@nestjs/passport | lockfile |
| @nestjs/platform-express | 11.2.7 | required | pkg:npm/@nestjs/platform-express@11.2.7 | package-lock.json#apps/api/node_modules/@nestjs/platform-express | lockfile |
| @nestjs/platform-socket.io | 11.2.7 | required | pkg:npm/@nestjs/platform-socket.io@11.2.7 | package-lock.json#apps/api/node_modules/@nestjs/platform-socket.io | lockfile |
| @nestjs/schedule | 12.0.2 | required | pkg:npm/@nestjs/schedule@12.0.2 | package-lock.json#apps/api/node_modules/@nestjs/schedule | lockfile |
| @nestjs/swagger | 11.4.7 | required | pkg:npm/@nestjs/swagger@11.4.7 | package-lock.json#node_modules/@nestjs/swagger | lockfile |
| @nestjs/terminus | 11.1.1 | required | pkg:npm/@nestjs/terminus@11.1.1 | package-lock.json#apps/api/node_modules/@nestjs/terminus | lockfile |
| @nestjs/throttler | 6.7.1 | required | pkg:npm/@nestjs/throttler@6.7.1 | package-lock.json#node_modules/@nestjs/throttler | lockfile |
| @nestjs/websockets | 11.2.7 | required | pkg:npm/@nestjs/websockets@11.2.7 | package-lock.json#apps/api/node_modules/@nestjs/websockets | lockfile |
| @next/env | 16.4.0 | required | pkg:npm/@next/env@16.4.0 | package-lock.json#node_modules/@next/env | lockfile |
| @next/swc-darwin-arm64 | 16.4.0 | optional | pkg:npm/@next/swc-darwin-arm64@16.4.0 | package-lock.json#node_modules/@next/swc-darwin-arm64 | lockfile |
| @next/swc-darwin-x64 | 16.4.0 | optional | pkg:npm/@next/swc-darwin-x64@16.4.0 | package-lock.json#node_modules/@next/swc-darwin-x64 | lockfile |
| @next/swc-linux-arm64-gnu | 16.4.0 | optional | pkg:npm/@next/swc-linux-arm64-gnu@16.4.0 | package-lock.json#node_modules/@next/swc-linux-arm64-gnu | lockfile |
| @next/swc-linux-arm64-musl | 16.4.0 | optional | pkg:npm/@next/swc-linux-arm64-musl@16.4.0 | package-lock.json#node_modules/@next/swc-linux-arm64-musl | lockfile |
| @next/swc-linux-x64-gnu | 16.4.0 | optional | pkg:npm/@next/swc-linux-x64-gnu@16.4.0 | package-lock.json#node_modules/@next/swc-linux-x64-gnu | lockfile |
| @next/swc-linux-x64-musl | 16.4.0 | optional | pkg:npm/@next/swc-linux-x64-musl@16.4.0 | package-lock.json#node_modules/@next/swc-linux-x64-musl | lockfile |
| @next/swc-win32-arm64-msvc | 16.4.0 | optional | pkg:npm/@next/swc-win32-arm64-msvc@16.4.0 | package-lock.json#node_modules/@next/swc-win32-arm64-msvc | lockfile |
| @next/swc-win32-x64-msvc | 16.4.0 | optional | pkg:npm/@next/swc-win32-x64-msvc@16.4.0 | package-lock.json#node_modules/@next/swc-win32-x64-msvc | lockfile |
| @nodable/entities | 3.1.0 | optional | pkg:npm/@nodable/entities@3.1.0 | package-lock.json#node_modules/@nodable/entities | lockfile |
| @node-saml/node-saml | 5.1.0 | required | pkg:npm/@node-saml/node-saml@5.1.0 | package-lock.json#node_modules/@node-saml/node-saml | lockfile |
| @otplib/core | 12.0.1 | required | pkg:npm/@otplib/core@12.0.1 | package-lock.json#node_modules/@otplib/core | lockfile |
| @otplib/plugin-crypto | 12.0.1 | required | pkg:npm/@otplib/plugin-crypto@12.0.1 | package-lock.json#node_modules/@otplib/plugin-crypto | lockfile |
| @otplib/plugin-thirty-two | 12.0.1 | required | pkg:npm/@otplib/plugin-thirty-two@12.0.1 | package-lock.json#node_modules/@otplib/plugin-thirty-two | lockfile |
| @otplib/preset-default | 12.0.1 | required | pkg:npm/@otplib/preset-default@12.0.1 | package-lock.json#node_modules/@otplib/preset-default | lockfile |
| @otplib/preset-v11 | 12.0.1 | required | pkg:npm/@otplib/preset-v11@12.0.1 | package-lock.json#node_modules/@otplib/preset-v11 | lockfile |
| @phc/format | 1.0.0 | required | pkg:npm/@phc/format@1.0.0 | package-lock.json#node_modules/@phc/format | lockfile |
| @pinojs/redact | 0.4.0 | required | pkg:npm/@pinojs/redact@0.4.0 | package-lock.json#node_modules/@pinojs/redact | lockfile |
| @socket.io/component-emitter | 3.1.2 | required | pkg:npm/@socket.io/component-emitter@3.1.2 | package-lock.json#node_modules/@socket.io/component-emitter | lockfile |
| @socket.io/redis-adapter | 8.3.0 | required | pkg:npm/@socket.io/redis-adapter@8.3.0 | package-lock.json#node_modules/@socket.io/redis-adapter | lockfile |
| @tanstack/query-core | 5.102.8 | required | pkg:npm/@tanstack/query-core@5.102.8 | package-lock.json#node_modules/@tanstack/query-core | lockfile |
| @tanstack/react-query | 5.102.8 | required | pkg:npm/@tanstack/react-query@5.102.8 | package-lock.json#node_modules/@tanstack/react-query | lockfile |
| @tokenizer/inflate | 0.4.1 | required | pkg:npm/@tokenizer/inflate@0.4.1 | package-lock.json#node_modules/@tokenizer/inflate | lockfile |
| @tokenizer/token | 0.3.0 | required | pkg:npm/@tokenizer/token@0.3.0 | package-lock.json#node_modules/@tokenizer/token | lockfile |
| @types/cors | 2.8.19 | required | pkg:npm/@types/cors@2.8.19 | package-lock.json#node_modules/@types/cors | lockfile |
| @types/debug | 4.1.13 | required | pkg:npm/@types/debug@4.1.13 | package-lock.json#node_modules/@types/debug | lockfile |
| @types/jsonwebtoken | 9.0.10 | required | pkg:npm/@types/jsonwebtoken@9.0.10 | package-lock.json#node_modules/@types/jsonwebtoken | lockfile |
| @types/luxon | 3.7.6 | required | pkg:npm/@types/luxon@3.7.6 | package-lock.json#apps/api/node_modules/@types/luxon | lockfile |
| @types/ms | 2.1.0 | required | pkg:npm/@types/ms@2.1.0 | package-lock.json#node_modules/@types/ms | lockfile |
| @types/node | 20.19.43 | required | pkg:npm/@types/node@20.19.43 | package-lock.json#node_modules/@types/node | lockfile |
| @types/qs | 6.15.1 | required | pkg:npm/@types/qs@6.15.1 | package-lock.json#node_modules/@types/qs | lockfile |
| @types/validator | 13.15.10 | required | pkg:npm/@types/validator@13.15.10 | package-lock.json#node_modules/@types/validator | lockfile |
| @types/ws | 8.18.1 | required | pkg:npm/@types/ws@8.18.1 | package-lock.json#node_modules/@types/ws | lockfile |
| @types/xml-encryption | 1.2.4 | required | pkg:npm/@types/xml-encryption@1.2.4 | package-lock.json#node_modules/@types/xml-encryption | lockfile |
| @types/xml2js | 0.4.14 | required | pkg:npm/@types/xml2js@0.4.14 | package-lock.json#node_modules/@types/xml2js | lockfile |
| @xmldom/is-dom-node | 1.0.1 | required | pkg:npm/@xmldom/is-dom-node@1.0.1 | package-lock.json#node_modules/@xmldom/is-dom-node | lockfile |
| @xmldom/xmldom | 0.8.15 | required | pkg:npm/@xmldom/xmldom@0.8.15 | package-lock.json#node_modules/@xmldom/xmldom | lockfile |
| abort-controller | 3.0.0 | optional | pkg:npm/abort-controller@3.0.0 | package-lock.json#node_modules/abort-controller | lockfile |
| accepts | 1.3.8 | required | pkg:npm/accepts@1.3.8 | package-lock.json#node_modules/accepts | lockfile |
| accepts | 2.0.0 | required | pkg:npm/accepts@2.0.0 | package-lock.json#apps/api/node_modules/accepts | lockfile |
| agent-base | 7.1.4 | optional | pkg:npm/agent-base@7.1.4 | package-lock.json#node_modules/agent-base | lockfile |
| ansi-regex | 5.0.1 | optional, required | pkg:npm/ansi-regex@5.0.1 | package-lock.json#node_modules/qrcode/node_modules/ansi-regex | lockfile |
| ansi-regex | 6.4.0 | optional | pkg:npm/ansi-regex@6.4.0 | package-lock.json#node_modules/ansi-regex | lockfile |
| ansi-styles | 4.3.0 | optional, required | pkg:npm/ansi-styles@4.3.0 | package-lock.json#node_modules/wrap-ansi-cjs/node_modules/ansi-styles | lockfile |
| ansi-styles | 6.2.3 | optional | pkg:npm/ansi-styles@6.2.3 | package-lock.json#node_modules/ansi-styles | lockfile |
| anynum | 1.0.1 | optional | pkg:npm/anynum@1.0.1 | package-lock.json#node_modules/anynum | lockfile |
| append-field | 1.0.0 | required | pkg:npm/append-field@1.0.0 | package-lock.json#node_modules/append-field | lockfile |
| argon2 | 0.41.1 | required | pkg:npm/argon2@0.41.1 | package-lock.json#node_modules/argon2 | lockfile |
| array-flatten | 1.1.1 | required | pkg:npm/array-flatten@1.1.1 | package-lock.json#node_modules/array-flatten | lockfile |
| async-retry | 1.3.3 | optional | pkg:npm/async-retry@1.3.3 | package-lock.json#node_modules/async-retry | lockfile |
| atomic-sleep | 1.0.0 | required | pkg:npm/atomic-sleep@1.0.0 | package-lock.json#node_modules/atomic-sleep | lockfile |
| balanced-match | 1.0.2 | optional | pkg:npm/balanced-match@1.0.2 | package-lock.json#node_modules/balanced-match | lockfile |
| base64-js | 1.5.1 | optional | pkg:npm/base64-js@1.5.1 | package-lock.json#node_modules/base64-js | lockfile |
| base64id | 2.0.0 | required | pkg:npm/base64id@2.0.0 | package-lock.json#node_modules/base64id | lockfile |
| bignumber.js | 9.3.1 | optional | pkg:npm/bignumber.js@9.3.1 | package-lock.json#node_modules/bignumber.js | lockfile |
| body-parser | 1.20.8 | required | pkg:npm/body-parser@1.20.8 | package-lock.json#node_modules/body-parser | lockfile |
| body-parser | 2.3.0 | required | pkg:npm/body-parser@2.3.0 | package-lock.json#apps/api/node_modules/body-parser | lockfile |
| boxen | 5.1.2 | required | pkg:npm/boxen@5.1.2 | package-lock.json#node_modules/boxen | lockfile |
| brace-expansion | 2.1.7 | optional | pkg:npm/brace-expansion@2.1.7 | package-lock.json#node_modules/brace-expansion | lockfile |
| bullmq | 5.81.4 | required | pkg:npm/bullmq@5.81.4 | package-lock.json#node_modules/bullmq | lockfile |
| busboy | 1.6.0 | required | pkg:npm/busboy@1.6.0 | package-lock.json#node_modules/busboy | npm registry metadata busboy@1.6.0 |
| bytes | 3.1.2 | required | pkg:npm/bytes@3.1.2 | package-lock.json#node_modules/bytes | lockfile |
| call-bind-apply-helpers | 1.0.2 | required | pkg:npm/call-bind-apply-helpers@1.0.2 | package-lock.json#node_modules/call-bind-apply-helpers | lockfile |
| call-bound | 1.0.4 | required | pkg:npm/call-bound@1.0.4 | package-lock.json#node_modules/call-bound | lockfile |
| camelcase | 5.3.1 | required | pkg:npm/camelcase@5.3.1 | package-lock.json#node_modules/qrcode/node_modules/camelcase | lockfile |
| camelcase | 6.3.0 | required | pkg:npm/camelcase@6.3.0 | package-lock.json#node_modules/camelcase | lockfile |
| chalk | 4.1.2 | required | pkg:npm/chalk@4.1.2 | package-lock.json#node_modules/chalk | lockfile |
| check-disk-space | 3.4.0 | required | pkg:npm/check-disk-space@3.4.0 | package-lock.json#node_modules/check-disk-space | lockfile |
| class-transformer | 0.5.1 | required | pkg:npm/class-transformer@0.5.1 | package-lock.json#node_modules/class-transformer | lockfile |
| class-validator | 0.14.4 | required | pkg:npm/class-validator@0.14.4 | package-lock.json#node_modules/class-validator | lockfile |
| cli-boxes | 2.2.1 | required | pkg:npm/cli-boxes@2.2.1 | package-lock.json#node_modules/cli-boxes | lockfile |
| client-only | 0.0.1 | required | pkg:npm/client-only@0.0.1 | package-lock.json#node_modules/client-only | lockfile |
| color-convert | 2.0.1 | required | pkg:npm/color-convert@2.0.1 | package-lock.json#node_modules/color-convert | lockfile |
| color-name | 1.1.4 | required | pkg:npm/color-name@1.1.4 | package-lock.json#node_modules/color-name | lockfile |
| compressible | 2.0.18 | required | pkg:npm/compressible@2.0.18 | package-lock.json#node_modules/compressible | lockfile |
| compression | 1.8.2 | required | pkg:npm/compression@1.8.2 | package-lock.json#node_modules/compression | lockfile |
| content-disposition | 0.5.4 | required | pkg:npm/content-disposition@0.5.4 | package-lock.json#node_modules/content-disposition | lockfile |
| content-disposition | 1.1.0 | required | pkg:npm/content-disposition@1.1.0 | package-lock.json#apps/api/node_modules/content-disposition | lockfile |
| content-type | 1.0.5 | required | pkg:npm/content-type@1.0.5 | package-lock.json#node_modules/content-type | lockfile |
| content-type | 2.1.0 | required | pkg:npm/content-type@2.1.0 | package-lock.json#apps/api/node_modules/@nestjs/platform-express/node_modules/type-is/node_modules/content-type | lockfile |
| cookie-parser | 1.4.7 | required | pkg:npm/cookie-parser@1.4.7 | package-lock.json#node_modules/cookie-parser | lockfile |
| cookie-signature | 1.0.6 | required | pkg:npm/cookie-signature@1.0.6 | package-lock.json#node_modules/cookie-signature | lockfile |
| cookie-signature | 1.2.2 | required | pkg:npm/cookie-signature@1.2.2 | package-lock.json#apps/api/node_modules/cookie-signature | lockfile |
| cookie | 0.7.2 | required | pkg:npm/cookie@0.7.2 | package-lock.json#node_modules/cookie | lockfile |
| cors | 2.8.6 | required | pkg:npm/cors@2.8.6 | package-lock.json#node_modules/cors | lockfile |
| cron-parser | 4.9.0 | required | pkg:npm/cron-parser@4.9.0 | package-lock.json#node_modules/cron-parser | lockfile |
| cron | 4.4.0 | required | pkg:npm/cron@4.4.0 | package-lock.json#apps/api/node_modules/cron | lockfile |
| cross-spawn | 7.0.6 | optional | pkg:npm/cross-spawn@7.0.6 | package-lock.json#node_modules/cross-spawn | lockfile |
| data-uri-to-buffer | 4.0.1 | optional | pkg:npm/data-uri-to-buffer@4.0.1 | package-lock.json#node_modules/data-uri-to-buffer | lockfile |
| debug | 2.6.9 | required | pkg:npm/debug@2.6.9 | package-lock.json#node_modules/body-parser/node_modules/debug | lockfile |
| debug | 4.3.7 | required | pkg:npm/debug@4.3.7 | package-lock.json#node_modules/debug | lockfile |
| debug | 4.4.3 | required | pkg:npm/debug@4.4.3 | package-lock.json#node_modules/socket.io/node_modules/debug | lockfile |
| decamelize | 1.2.0 | required | pkg:npm/decamelize@1.2.0 | package-lock.json#node_modules/decamelize | lockfile |
| depd | 2.0.0 | required | pkg:npm/depd@2.0.0 | package-lock.json#node_modules/depd | lockfile |
| destroy | 1.2.0 | required | pkg:npm/destroy@1.2.0 | package-lock.json#node_modules/destroy | lockfile |
| dijkstrajs | 1.0.3 | required | pkg:npm/dijkstrajs@1.0.3 | package-lock.json#node_modules/dijkstrajs | lockfile |
| dunder-proto | 1.0.1 | required | pkg:npm/dunder-proto@1.0.1 | package-lock.json#node_modules/dunder-proto | lockfile |
| duplexify | 4.1.3 | optional | pkg:npm/duplexify@4.1.3 | package-lock.json#node_modules/duplexify | lockfile |
| eastasianwidth | 0.2.0 | optional | pkg:npm/eastasianwidth@0.2.0 | package-lock.json#node_modules/eastasianwidth | lockfile |
| ee-first | 1.1.1 | required | pkg:npm/ee-first@1.1.1 | package-lock.json#node_modules/ee-first | lockfile |
| emoji-regex | 8.0.0 | optional, required | pkg:npm/emoji-regex@8.0.0 | package-lock.json#node_modules/ansi-align/node_modules/emoji-regex | lockfile |
| emoji-regex | 9.2.2 | optional | pkg:npm/emoji-regex@9.2.2 | package-lock.json#node_modules/emoji-regex | lockfile |
| encodeurl | 2.0.0 | required | pkg:npm/encodeurl@2.0.0 | package-lock.json#node_modules/encodeurl | lockfile |
| end-of-stream | 1.4.5 | optional | pkg:npm/end-of-stream@1.4.5 | package-lock.json#node_modules/end-of-stream | lockfile |
| engine.io-client | 6.6.6 | required | pkg:npm/engine.io-client@6.6.6 | package-lock.json#node_modules/engine.io-client | lockfile |
| engine.io-parser | 5.2.3 | required | pkg:npm/engine.io-parser@5.2.3 | package-lock.json#node_modules/engine.io-parser | lockfile |
| engine.io | 6.6.10 | required | pkg:npm/engine.io@6.6.10 | package-lock.json#node_modules/engine.io | lockfile |
| es-define-property | 1.0.1 | required | pkg:npm/es-define-property@1.0.1 | package-lock.json#node_modules/es-define-property | lockfile |
| es-errors | 1.3.0 | required | pkg:npm/es-errors@1.3.0 | package-lock.json#node_modules/es-errors | lockfile |
| es-object-atoms | 1.1.2 | required | pkg:npm/es-object-atoms@1.1.2 | package-lock.json#node_modules/es-object-atoms | lockfile |
| escalade | 3.2.0 | optional | pkg:npm/escalade@3.2.0 | package-lock.json#node_modules/escalade | lockfile |
| escape-html | 1.0.3 | required | pkg:npm/escape-html@1.0.3 | package-lock.json#node_modules/escape-html | lockfile |
| etag | 1.8.1 | required | pkg:npm/etag@1.8.1 | package-lock.json#node_modules/etag | lockfile |
| event-target-shim | 5.0.1 | optional | pkg:npm/event-target-shim@5.0.1 | package-lock.json#node_modules/event-target-shim | lockfile |
| express | 4.22.3 | required | pkg:npm/express@4.22.3 | package-lock.json#node_modules/express | lockfile |
| express | 5.2.1 | required | pkg:npm/express@5.2.1 | package-lock.json#apps/api/node_modules/@nestjs/platform-express/node_modules/express | lockfile |
| extend | 3.0.2 | optional | pkg:npm/extend@3.0.2 | package-lock.json#node_modules/extend | lockfile |
| fast-deep-equal | 3.1.3 | optional | pkg:npm/fast-deep-equal@3.1.3 | package-lock.json#node_modules/fast-deep-equal | lockfile |
| fast-safe-stringify | 2.1.1 | required | pkg:npm/fast-safe-stringify@2.1.1 | package-lock.json#node_modules/fast-safe-stringify | lockfile |
| fast-xml-builder | 1.3.1 | optional | pkg:npm/fast-xml-builder@1.3.1 | package-lock.json#node_modules/fast-xml-builder | lockfile |
| fast-xml-parser | 5.11.2 | optional | pkg:npm/fast-xml-parser@5.11.2 | package-lock.json#node_modules/fast-xml-parser | lockfile |
| fetch-blob | 3.2.0 | optional | pkg:npm/fetch-blob@3.2.0 | package-lock.json#node_modules/fetch-blob | lockfile |
| file-type | 21.3.4 | required | pkg:npm/file-type@21.3.4 | package-lock.json#node_modules/file-type | lockfile |
| finalhandler | 1.3.2 | required | pkg:npm/finalhandler@1.3.2 | package-lock.json#node_modules/finalhandler | lockfile |
| finalhandler | 2.1.1 | required | pkg:npm/finalhandler@2.1.1 | package-lock.json#apps/api/node_modules/finalhandler | lockfile |
| find-up | 4.1.0 | required | pkg:npm/find-up@4.1.0 | package-lock.json#node_modules/qrcode/node_modules/find-up | lockfile |
| formdata-polyfill | 4.0.10 | optional | pkg:npm/formdata-polyfill@4.0.10 | package-lock.json#node_modules/formdata-polyfill | lockfile |
| forwarded | 0.2.0 | required | pkg:npm/forwarded@0.2.0 | package-lock.json#node_modules/forwarded | lockfile |
| fresh | 0.5.2 | required | pkg:npm/fresh@0.5.2 | package-lock.json#node_modules/fresh | lockfile |
| fresh | 2.0.0 | required | pkg:npm/fresh@2.0.0 | package-lock.json#apps/api/node_modules/fresh | lockfile |
| function-bind | 1.1.2 | required | pkg:npm/function-bind@1.1.2 | package-lock.json#node_modules/function-bind | lockfile |
| functional-red-black-tree | 1.0.1 | optional | pkg:npm/functional-red-black-tree@1.0.1 | package-lock.json#node_modules/functional-red-black-tree | lockfile |
| get-intrinsic | 1.3.0 | required | pkg:npm/get-intrinsic@1.3.0 | package-lock.json#node_modules/get-intrinsic | lockfile |
| get-proto | 1.0.1 | required | pkg:npm/get-proto@1.0.1 | package-lock.json#node_modules/get-proto | lockfile |
| gopd | 1.2.0 | required | pkg:npm/gopd@1.2.0 | package-lock.json#node_modules/gopd | lockfile |
| gtoken | 8.0.0 | optional | pkg:npm/gtoken@8.0.0 | package-lock.json#node_modules/gtoken | lockfile |
| has-flag | 4.0.0 | required | pkg:npm/has-flag@4.0.0 | package-lock.json#node_modules/has-flag | lockfile |
| has-symbols | 1.1.0 | required | pkg:npm/has-symbols@1.1.0 | package-lock.json#node_modules/has-symbols | lockfile |
| hasown | 2.0.4 | required | pkg:npm/hasown@2.0.4 | package-lock.json#node_modules/hasown | lockfile |
| helmet | 7.2.0 | required | pkg:npm/helmet@7.2.0 | package-lock.json#node_modules/helmet | lockfile |
| html-entities | 2.6.0 | optional | pkg:npm/html-entities@2.6.0 | package-lock.json#node_modules/html-entities | lockfile |
| http-errors | 2.0.1 | required | pkg:npm/http-errors@2.0.1 | package-lock.json#node_modules/http-errors | lockfile |
| http-parser-js | 0.5.10 | optional | pkg:npm/http-parser-js@0.5.10 | package-lock.json#node_modules/http-parser-js | lockfile |
| http-proxy-agent | 7.0.2 | optional | pkg:npm/http-proxy-agent@7.0.2 | package-lock.json#node_modules/http-proxy-agent | lockfile |
| https-proxy-agent | 7.0.6 | optional | pkg:npm/https-proxy-agent@7.0.6 | package-lock.json#node_modules/https-proxy-agent | lockfile |
| iconv-lite | 0.4.24 | required | pkg:npm/iconv-lite@0.4.24 | package-lock.json#node_modules/iconv-lite | lockfile |
| iconv-lite | 0.7.3 | required | pkg:npm/iconv-lite@0.7.3 | package-lock.json#apps/api/node_modules/iconv-lite | lockfile |
| ioredis | 5.11.1 | required | pkg:npm/ioredis@5.11.1 | package-lock.json#node_modules/ioredis | lockfile |
| ipaddr.js | 1.9.1 | required | pkg:npm/ipaddr.js@1.9.1 | package-lock.json#node_modules/ipaddr.js | lockfile |
| is-fullwidth-code-point | 3.0.0 | required | pkg:npm/is-fullwidth-code-point@3.0.0 | package-lock.json#node_modules/is-fullwidth-code-point | lockfile |
| is-promise | 4.0.0 | required | pkg:npm/is-promise@4.0.0 | package-lock.json#node_modules/is-promise | lockfile |
| is-unsafe | 2.0.2 | optional | pkg:npm/is-unsafe@2.0.2 | package-lock.json#node_modules/is-unsafe | lockfile |
| jose | 5.10.0 | required | pkg:npm/jose@5.10.0 | package-lock.json#node_modules/jose | lockfile |
| jose | 6.2.12 | optional | pkg:npm/jose@6.2.12 | package-lock.json#node_modules/jwks-rsa/node_modules/jose | lockfile |
| js-yaml | 5.4.3 | required | pkg:npm/js-yaml@5.4.3 | package-lock.json#node_modules/@nestjs/swagger/node_modules/js-yaml | lockfile |
| json-bigint | 1.0.0 | optional | pkg:npm/json-bigint@1.0.0 | package-lock.json#node_modules/json-bigint | lockfile |
| jsonwebtoken | 9.0.3 | required | pkg:npm/jsonwebtoken@9.0.3 | package-lock.json#node_modules/jsonwebtoken | lockfile |
| jwa | 2.0.1 | required | pkg:npm/jwa@2.0.1 | package-lock.json#node_modules/jwa | lockfile |
| jwks-rsa | 4.1.0 | optional | pkg:npm/jwks-rsa@4.1.0 | package-lock.json#node_modules/jwks-rsa | lockfile |
| jws | 4.0.1 | required | pkg:npm/jws@4.0.1 | package-lock.json#node_modules/jws | lockfile |
| libphonenumber-js | 1.13.12 | required | pkg:npm/libphonenumber-js@1.13.12 | package-lock.json#node_modules/libphonenumber-js | lockfile |
| limiter | 1.1.5 | optional | pkg:npm/limiter@1.1.5 | package-lock.json#node_modules/limiter | npm registry metadata limiter@1.1.5 |
| load-esm | 1.0.3 | required | pkg:npm/load-esm@1.0.3 | package-lock.json#node_modules/load-esm | lockfile |
| locate-path | 5.0.0 | required | pkg:npm/locate-path@5.0.0 | package-lock.json#node_modules/qrcode/node_modules/locate-path | lockfile |
| lodash.camelcase | 4.3.0 | optional | pkg:npm/lodash.camelcase@4.3.0 | package-lock.json#node_modules/lodash.camelcase | lockfile |
| lodash.clonedeep | 4.5.0 | optional | pkg:npm/lodash.clonedeep@4.5.0 | package-lock.json#node_modules/lodash.clonedeep | lockfile |
| lodash.includes | 4.3.0 | required | pkg:npm/lodash.includes@4.3.0 | package-lock.json#node_modules/lodash.includes | lockfile |
| lodash.isboolean | 3.0.3 | required | pkg:npm/lodash.isboolean@3.0.3 | package-lock.json#node_modules/lodash.isboolean | lockfile |
| lodash.isinteger | 4.0.4 | required | pkg:npm/lodash.isinteger@4.0.4 | package-lock.json#node_modules/lodash.isinteger | lockfile |
| lodash.isnumber | 3.0.3 | required | pkg:npm/lodash.isnumber@3.0.3 | package-lock.json#node_modules/lodash.isnumber | lockfile |
| lodash.isplainobject | 4.0.6 | required | pkg:npm/lodash.isplainobject@4.0.6 | package-lock.json#node_modules/lodash.isplainobject | lockfile |
| lodash.isstring | 4.0.1 | required | pkg:npm/lodash.isstring@4.0.1 | package-lock.json#node_modules/lodash.isstring | lockfile |
| lodash.once | 4.1.1 | required | pkg:npm/lodash.once@4.1.1 | package-lock.json#node_modules/lodash.once | lockfile |
| lodash | 4.18.1 | required | pkg:npm/lodash@4.18.1 | package-lock.json#node_modules/lodash | lockfile |
| lru-memoizer | 3.0.0 | optional | pkg:npm/lru-memoizer@3.0.0 | package-lock.json#node_modules/lru-memoizer | lockfile |
| luxon | 3.7.2 | required | pkg:npm/luxon@3.7.2 | package-lock.json#node_modules/luxon | lockfile |
| math-intrinsics | 1.1.0 | required | pkg:npm/math-intrinsics@1.1.0 | package-lock.json#node_modules/math-intrinsics | lockfile |
| media-typer | 0.3.0 | required | pkg:npm/media-typer@0.3.0 | package-lock.json#node_modules/media-typer | lockfile |
| media-typer | 1.1.1 | required | pkg:npm/media-typer@1.1.1 | package-lock.json#apps/api/node_modules/media-typer | lockfile |
| merge-descriptors | 1.0.3 | required | pkg:npm/merge-descriptors@1.0.3 | package-lock.json#node_modules/merge-descriptors | lockfile |
| merge-descriptors | 2.0.0 | required | pkg:npm/merge-descriptors@2.0.0 | package-lock.json#apps/api/node_modules/merge-descriptors | lockfile |
| methods | 1.1.2 | required | pkg:npm/methods@1.1.2 | package-lock.json#node_modules/methods | lockfile |
| mime-db | 1.52.0 | required | pkg:npm/mime-db@1.52.0 | package-lock.json#node_modules/mime-types/node_modules/mime-db | lockfile |
| mime-db | 1.54.0 | required | pkg:npm/mime-db@1.54.0 | package-lock.json#node_modules/mime-db | lockfile |
| mime-types | 2.1.35 | required | pkg:npm/mime-types@2.1.35 | package-lock.json#node_modules/mime-types | lockfile |
| mime-types | 3.0.2 | required | pkg:npm/mime-types@3.0.2 | package-lock.json#apps/api/node_modules/mime-types | lockfile |
| mime | 1.6.0 | required | pkg:npm/mime@1.6.0 | package-lock.json#node_modules/mime | lockfile |
| mime | 3.0.0 | optional | pkg:npm/mime@3.0.0 | package-lock.json#node_modules/@google-cloud/storage/node_modules/mime | lockfile |
| ms | 2.0.0 | required | pkg:npm/ms@2.0.0 | package-lock.json#node_modules/express/node_modules/ms | lockfile |
| ms | 2.1.3 | required | pkg:npm/ms@2.1.3 | package-lock.json#node_modules/ms | lockfile |
| msgpackr-extract | 3.0.4 | optional | pkg:npm/msgpackr-extract@3.0.4 | package-lock.json#node_modules/msgpackr-extract | lockfile |
| msgpackr | 2.0.5 | required | pkg:npm/msgpackr@2.0.5 | package-lock.json#node_modules/msgpackr | lockfile |
| multer | 2.4.0 | required | pkg:npm/multer@2.4.0 | package-lock.json#apps/api/node_modules/multer | lockfile |
| nanoid | 3.3.20 | required | pkg:npm/nanoid@3.3.20 | package-lock.json#node_modules/nanoid | lockfile |
| negotiator | 0.6.3 | required | pkg:npm/negotiator@0.6.3 | package-lock.json#node_modules/accepts/node_modules/negotiator | lockfile |
| negotiator | 0.6.4 | required | pkg:npm/negotiator@0.6.4 | package-lock.json#node_modules/negotiator | lockfile |
| negotiator | 1.1.0 | required | pkg:npm/negotiator@1.1.0 | package-lock.json#apps/api/node_modules/negotiator | lockfile |
| nestjs-pino | 4.6.1 | required | pkg:npm/nestjs-pino@4.6.1 | package-lock.json#node_modules/nestjs-pino | lockfile |
| next | 16.4.0 | required | pkg:npm/next@16.4.0 | package-lock.json#node_modules/next | lockfile |
| node-abort-controller | 3.1.1 | required | pkg:npm/node-abort-controller@3.1.1 | package-lock.json#node_modules/node-abort-controller | lockfile |
| node-addon-api | 8.9.2 | required | pkg:npm/node-addon-api@8.9.2 | package-lock.json#node_modules/node-addon-api | lockfile |
| node-domexception | 1.0.0 | optional | pkg:npm/node-domexception@1.0.0 | package-lock.json#node_modules/node-domexception | lockfile |
| node-fetch | 3.3.2 | optional | pkg:npm/node-fetch@3.3.2 | package-lock.json#node_modules/node-fetch | lockfile |
| node-gyp-build-optional-packages | 5.2.2 | optional | pkg:npm/node-gyp-build-optional-packages@5.2.2 | package-lock.json#node_modules/node-gyp-build-optional-packages | lockfile |
| node-gyp-build | 4.8.4 | required | pkg:npm/node-gyp-build@4.8.4 | package-lock.json#node_modules/node-gyp-build | lockfile |
| notepack.io | 3.0.1 | required | pkg:npm/notepack.io@3.0.1 | package-lock.json#node_modules/notepack.io | lockfile |
| object-assign | 4.1.1 | required | pkg:npm/object-assign@4.1.1 | package-lock.json#node_modules/object-assign | lockfile |
| object-hash | 3.0.0 | required | pkg:npm/object-hash@3.0.0 | package-lock.json#node_modules/object-hash | lockfile |
| object-inspect | 1.13.4 | required | pkg:npm/object-inspect@1.13.4 | package-lock.json#node_modules/object-inspect | lockfile |
| on-exit-leak-free | 2.1.2 | required | pkg:npm/on-exit-leak-free@2.1.2 | package-lock.json#node_modules/on-exit-leak-free | lockfile |
| on-finished | 2.4.1 | required | pkg:npm/on-finished@2.4.1 | package-lock.json#node_modules/on-finished | lockfile |
| on-headers | 1.1.0 | required | pkg:npm/on-headers@1.1.0 | package-lock.json#node_modules/on-headers | lockfile |
| otplib | 12.0.1 | required | pkg:npm/otplib@12.0.1 | package-lock.json#node_modules/otplib | lockfile |
| p-limit | 2.3.0 | required | pkg:npm/p-limit@2.3.0 | package-lock.json#node_modules/qrcode/node_modules/p-limit | lockfile |
| p-limit | 3.1.0 | optional | pkg:npm/p-limit@3.1.0 | package-lock.json#node_modules/p-limit | lockfile |
| p-locate | 4.1.0 | required | pkg:npm/p-locate@4.1.0 | package-lock.json#node_modules/qrcode/node_modules/p-locate | lockfile |
| p-try | 2.2.0 | required | pkg:npm/p-try@2.2.0 | package-lock.json#node_modules/p-try | lockfile |
| parseurl | 1.3.3 | required | pkg:npm/parseurl@1.3.3 | package-lock.json#node_modules/parseurl | lockfile |
| passport-jwt | 4.0.1 | required | pkg:npm/passport-jwt@4.0.1 | package-lock.json#node_modules/passport-jwt | lockfile |
| passport-strategy | 1.0.0 | required | pkg:npm/passport-strategy@1.0.0 | package-lock.json#node_modules/passport-strategy | npm registry metadata passport-strategy@1.0.0 |
| passport | 0.7.0 | required | pkg:npm/passport@0.7.0 | package-lock.json#node_modules/passport | lockfile |
| path-exists | 4.0.0 | required | pkg:npm/path-exists@4.0.0 | package-lock.json#node_modules/path-exists | lockfile |
| path-expression-matcher | 1.6.2 | optional | pkg:npm/path-expression-matcher@1.6.2 | package-lock.json#node_modules/path-expression-matcher | lockfile |
| path-key | 3.1.1 | optional | pkg:npm/path-key@3.1.1 | package-lock.json#node_modules/path-key | lockfile |
| path-to-regexp | 0.1.13 | required | pkg:npm/path-to-regexp@0.1.13 | package-lock.json#node_modules/express/node_modules/path-to-regexp | lockfile |
| path-to-regexp | 8.4.2 | required | pkg:npm/path-to-regexp@8.4.2 | package-lock.json#node_modules/path-to-regexp | lockfile |
| pause | 0.0.1 | required | pkg:npm/pause@0.0.1 | package-lock.json#node_modules/pause | npm package archive verified by package-lock.json for pause@0.0.1 |
| pino-abstract-transport | 2.0.0 | required | pkg:npm/pino-abstract-transport@2.0.0 | package-lock.json#node_modules/pino-abstract-transport | lockfile |
| pino-http | 10.5.0 | required | pkg:npm/pino-http@10.5.0 | package-lock.json#node_modules/pino-http | lockfile |
| pino-std-serializers | 7.1.0 | required | pkg:npm/pino-std-serializers@7.1.0 | package-lock.json#node_modules/pino-std-serializers | lockfile |
| pino | 9.14.0 | required | pkg:npm/pino@9.14.0 | package-lock.json#node_modules/pino | lockfile |
| pngjs | 5.0.0 | required | pkg:npm/pngjs@5.0.0 | package-lock.json#node_modules/pngjs | lockfile |
| postcss | 8.5.23 | required | pkg:npm/postcss@8.5.23 | package-lock.json#node_modules/postcss | lockfile |
| process-warning | 5.1.0 | required | pkg:npm/process-warning@5.1.0 | package-lock.json#node_modules/process-warning | lockfile |
| proxy-addr | 2.0.8 | required | pkg:npm/proxy-addr@2.0.8 | package-lock.json#node_modules/proxy-addr | lockfile |
| qrcode | 1.5.4 | required | pkg:npm/qrcode@1.5.4 | package-lock.json#node_modules/qrcode | lockfile |
| quick-format-unescaped | 4.0.4 | required | pkg:npm/quick-format-unescaped@4.0.4 | package-lock.json#node_modules/quick-format-unescaped | lockfile |
| range-parser | 1.2.1 | required | pkg:npm/range-parser@1.2.1 | package-lock.json#node_modules/range-parser | lockfile |
| raw-body | 2.5.3 | required | pkg:npm/raw-body@2.5.3 | package-lock.json#node_modules/raw-body | lockfile |
| raw-body | 3.0.2 | required | pkg:npm/raw-body@3.0.2 | package-lock.json#apps/api/node_modules/raw-body | lockfile |
| react-dom | 19.3.0 | required | pkg:npm/react-dom@19.3.0 | package-lock.json#node_modules/react-dom | lockfile |
| react | 19.3.0 | required | pkg:npm/react@19.3.0 | package-lock.json#node_modules/react | lockfile |
| readable-stream | 3.6.2 | optional | pkg:npm/readable-stream@3.6.2 | package-lock.json#node_modules/readable-stream | lockfile |
| real-require | 0.2.0 | required | pkg:npm/real-require@0.2.0 | package-lock.json#node_modules/real-require | lockfile |
| redis-errors | 1.2.0 | required | pkg:npm/redis-errors@1.2.0 | package-lock.json#node_modules/redis-errors | lockfile |
| redis-parser | 3.0.0 | required | pkg:npm/redis-parser@3.0.0 | package-lock.json#node_modules/redis-parser | lockfile |
| require-directory | 2.1.1 | required | pkg:npm/require-directory@2.1.1 | package-lock.json#node_modules/require-directory | lockfile |
| retry-request | 8.0.4 | optional | pkg:npm/retry-request@8.0.4 | package-lock.json#node_modules/@google-cloud/firestore-api/node_modules/retry-request | lockfile |
| retry-request | 9.0.2 | optional | pkg:npm/retry-request@9.0.2 | package-lock.json#node_modules/retry-request | lockfile |
| retry | 0.13.1 | optional | pkg:npm/retry@0.13.1 | package-lock.json#node_modules/retry | lockfile |
| router | 2.2.0 | required | pkg:npm/router@2.2.0 | package-lock.json#node_modules/router | lockfile |
| safe-buffer | 5.2.1 | required | pkg:npm/safe-buffer@5.2.1 | package-lock.json#node_modules/safe-buffer | lockfile |
| safe-stable-stringify | 2.5.0 | required | pkg:npm/safe-stable-stringify@2.5.0 | package-lock.json#node_modules/safe-stable-stringify | lockfile |
| safer-buffer | 2.1.2 | required | pkg:npm/safer-buffer@2.1.2 | package-lock.json#node_modules/safer-buffer | lockfile |
| scheduler | 0.28.0 | required | pkg:npm/scheduler@0.28.0 | package-lock.json#node_modules/scheduler | lockfile |
| send | 0.19.2 | required | pkg:npm/send@0.19.2 | package-lock.json#node_modules/send | lockfile |
| send | 1.2.1 | required | pkg:npm/send@1.2.1 | package-lock.json#apps/api/node_modules/send | lockfile |
| serve-static | 1.16.3 | required | pkg:npm/serve-static@1.16.3 | package-lock.json#node_modules/serve-static | lockfile |
| serve-static | 2.2.1 | required | pkg:npm/serve-static@2.2.1 | package-lock.json#apps/api/node_modules/serve-static | lockfile |
| server-only | 0.0.1 | required | pkg:npm/server-only@0.0.1 | package-lock.json#node_modules/server-only | lockfile |
| shebang-command | 2.0.0 | optional | pkg:npm/shebang-command@2.0.0 | package-lock.json#node_modules/shebang-command | lockfile |
| shebang-regex | 3.0.0 | optional | pkg:npm/shebang-regex@3.0.0 | package-lock.json#node_modules/shebang-regex | lockfile |
| side-channel-list | 1.0.1 | required | pkg:npm/side-channel-list@1.0.1 | package-lock.json#node_modules/side-channel-list | lockfile |
| side-channel-map | 1.0.1 | required | pkg:npm/side-channel-map@1.0.1 | package-lock.json#node_modules/side-channel-map | lockfile |
| side-channel-weakmap | 1.0.2 | required | pkg:npm/side-channel-weakmap@1.0.2 | package-lock.json#node_modules/side-channel-weakmap | lockfile |
| side-channel | 1.1.1 | required | pkg:npm/side-channel@1.1.1 | package-lock.json#node_modules/side-channel | lockfile |
| socket.io-adapter | 2.5.8 | required | pkg:npm/socket.io-adapter@2.5.8 | package-lock.json#node_modules/socket.io-adapter | lockfile |
| socket.io-client | 4.8.3 | required | pkg:npm/socket.io-client@4.8.3 | package-lock.json#node_modules/socket.io-client | lockfile |
| socket.io-parser | 4.2.7 | required | pkg:npm/socket.io-parser@4.2.7 | package-lock.json#node_modules/socket.io-parser | lockfile |
| socket.io | 4.8.3 | required | pkg:npm/socket.io@4.8.3 | package-lock.json#node_modules/socket.io | lockfile |
| sonic-boom | 4.2.1 | required | pkg:npm/sonic-boom@4.2.1 | package-lock.json#node_modules/sonic-boom | lockfile |
| standard-as-callback | 2.1.0 | required | pkg:npm/standard-as-callback@2.1.0 | package-lock.json#node_modules/standard-as-callback | lockfile |
| statuses | 2.0.2 | required | pkg:npm/statuses@2.0.2 | package-lock.json#node_modules/statuses | lockfile |
| stream-events | 1.0.5 | optional | pkg:npm/stream-events@1.0.5 | package-lock.json#node_modules/stream-events | lockfile |
| stream-shift | 1.0.3 | optional | pkg:npm/stream-shift@1.0.3 | package-lock.json#node_modules/stream-shift | lockfile |
| streamsearch | 1.1.0 | required | pkg:npm/streamsearch@1.1.0 | package-lock.json#node_modules/streamsearch | npm registry metadata streamsearch@1.1.0 |
| string_decoder | 1.3.0 | optional | pkg:npm/string_decoder@1.3.0 | package-lock.json#node_modules/string_decoder | lockfile |
| string-width | 4.2.3 | optional, required | pkg:npm/string-width@4.2.3 | package-lock.json#node_modules/widest-line/node_modules/string-width | lockfile |
| string-width | 5.1.2 | optional | pkg:npm/string-width@5.1.2 | package-lock.json#node_modules/string-width | lockfile |
| strip-ansi | 6.0.1 | optional, required | pkg:npm/strip-ansi@6.0.1 | package-lock.json#node_modules/qrcode/node_modules/strip-ansi | lockfile |
| strip-ansi | 7.2.0 | optional | pkg:npm/strip-ansi@7.2.0 | package-lock.json#node_modules/strip-ansi | lockfile |
| stripe | 14.25.0 | required | pkg:npm/stripe@14.25.0 | package-lock.json#node_modules/stripe | lockfile |
| strnum | 2.4.2 | optional | pkg:npm/strnum@2.4.2 | package-lock.json#node_modules/strnum | lockfile |
| strtok3 | 10.3.5 | required | pkg:npm/strtok3@10.3.5 | package-lock.json#node_modules/strtok3 | lockfile |
| stubs | 3.0.0 | optional | pkg:npm/stubs@3.0.0 | package-lock.json#node_modules/stubs | lockfile |
| styled-jsx | 5.1.6 | required | pkg:npm/styled-jsx@5.1.6 | package-lock.json#node_modules/styled-jsx | lockfile |
| supports-color | 7.2.0 | required | pkg:npm/supports-color@7.2.0 | package-lock.json#node_modules/supports-color | lockfile |
| thirty-two | 1.0.2 | required | pkg:npm/thirty-two@1.0.2 | package-lock.json#node_modules/thirty-two | npm package archive verified by package-lock.json for thirty-two@1.0.2 |
| thread-stream | 3.2.0 | required | pkg:npm/thread-stream@3.2.0 | package-lock.json#node_modules/thread-stream | lockfile |
| toidentifier | 1.0.1 | required | pkg:npm/toidentifier@1.0.1 | package-lock.json#node_modules/toidentifier | lockfile |
| token-types | 6.1.2 | required | pkg:npm/token-types@6.1.2 | package-lock.json#node_modules/token-types | lockfile |
| type-is | 1.6.18 | required | pkg:npm/type-is@1.6.18 | package-lock.json#node_modules/type-is | lockfile |
| type-is | 2.1.0 | required | pkg:npm/type-is@2.1.0 | package-lock.json#apps/api/node_modules/body-parser/node_modules/type-is | lockfile |
| uid | 2.0.2 | required | pkg:npm/uid@2.0.2 | package-lock.json#node_modules/uid | lockfile |
| uid2 | 1.0.0 | required | pkg:npm/uid2@1.0.0 | package-lock.json#node_modules/uid2 | lockfile |
| uint8array-extras | 1.6.0 | required | pkg:npm/uint8array-extras@1.6.0 | package-lock.json#node_modules/uint8array-extras | lockfile |
| undici-types | 6.21.0 | required | pkg:npm/undici-types@6.21.0 | package-lock.json#node_modules/undici-types | lockfile |
| unpipe | 1.0.0 | required | pkg:npm/unpipe@1.0.0 | package-lock.json#node_modules/unpipe | lockfile |
| util-deprecate | 1.0.2 | optional | pkg:npm/util-deprecate@1.0.2 | package-lock.json#node_modules/util-deprecate | lockfile |
| utils-merge | 1.0.1 | required | pkg:npm/utils-merge@1.0.1 | package-lock.json#node_modules/utils-merge | lockfile |
| validator | 13.15.35 | required | pkg:npm/validator@13.15.35 | package-lock.json#node_modules/validator | lockfile |
| vary | 1.1.2 | required | pkg:npm/vary@1.1.2 | package-lock.json#node_modules/vary | lockfile |
| web-streams-polyfill | 3.3.3 | optional | pkg:npm/web-streams-polyfill@3.3.3 | package-lock.json#node_modules/web-streams-polyfill | lockfile |
| widest-line | 3.1.0 | required | pkg:npm/widest-line@3.1.0 | package-lock.json#node_modules/widest-line | lockfile |
| wrap-ansi | 6.2.0 | required | pkg:npm/wrap-ansi@6.2.0 | package-lock.json#node_modules/qrcode/node_modules/wrap-ansi | lockfile |
| wrap-ansi | 7.0.0 | optional, required | pkg:npm/wrap-ansi@7.0.0 | package-lock.json#node_modules/wrap-ansi-cjs | lockfile |
| wrap-ansi | 8.1.0 | optional | pkg:npm/wrap-ansi@8.1.0 | package-lock.json#node_modules/wrap-ansi | lockfile |
| ws | 8.21.3 | required | pkg:npm/ws@8.21.3 | package-lock.json#node_modules/ws | lockfile |
| xml-crypto | 6.3.2 | required | pkg:npm/xml-crypto@6.3.2 | package-lock.json#node_modules/xml-crypto | lockfile |
| xml-encryption | 3.1.0 | required | pkg:npm/xml-encryption@3.1.0 | package-lock.json#node_modules/xml-encryption | lockfile |
| xml-naming | 0.3.0 | optional | pkg:npm/xml-naming@0.3.0 | package-lock.json#node_modules/xml-naming | lockfile |
| xml2js | 0.6.2 | required | pkg:npm/xml2js@0.6.2 | package-lock.json#node_modules/xml2js | lockfile |
| xmlbuilder | 11.0.1 | required | pkg:npm/xmlbuilder@11.0.1 | package-lock.json#node_modules/xml2js/node_modules/xmlbuilder | lockfile |
| xmlbuilder | 15.1.1 | required | pkg:npm/xmlbuilder@15.1.1 | package-lock.json#node_modules/xmlbuilder | lockfile |
| xmlhttprequest-ssl | 2.1.2 | required | pkg:npm/xmlhttprequest-ssl@2.1.2 | package-lock.json#node_modules/xmlhttprequest-ssl | npm registry metadata xmlhttprequest-ssl@2.1.2 |
| xpath | 0.0.32 | required | pkg:npm/xpath@0.0.32 | package-lock.json#node_modules/xml-encryption/node_modules/xpath | lockfile |
| xpath | 0.0.33 | required | pkg:npm/xpath@0.0.33 | package-lock.json#node_modules/xml-crypto/node_modules/xpath | lockfile |
| xpath | 0.0.34 | required | pkg:npm/xpath@0.0.34 | package-lock.json#node_modules/xpath | lockfile |
| yargs | 15.4.1 | required | pkg:npm/yargs@15.4.1 | package-lock.json#node_modules/qrcode/node_modules/yargs | lockfile |
| yargs | 17.7.3 | optional | pkg:npm/yargs@17.7.3 | package-lock.json#node_modules/yargs | lockfile |
| yocto-queue | 0.1.0 | optional | pkg:npm/yocto-queue@0.1.0 | package-lock.json#node_modules/yocto-queue | lockfile |
| zod | 3.25.76 | required | pkg:npm/zod@3.25.76 | package-lock.json#node_modules/zod | lockfile |
| dio_web_adapter | 2.2.2 | required | pkg:pub/dio_web_adapter@2.2.2 | apps/mobile/pubspec.lock#dio_web_adapter | pub.dev archive SHA-256 verified by pubspec.lock for dio_web_adapter@2.2.2 |
| dio | 5.11.1 | required | pkg:pub/dio@5.11.1 | apps/mobile/pubspec.lock#dio | pub.dev archive SHA-256 verified by pubspec.lock for dio@5.11.1 |
| equatable | 2.1.0 | required | pkg:pub/equatable@2.1.0 | apps/mobile/pubspec.lock#equatable | pub.dev archive SHA-256 verified by pubspec.lock for equatable@2.1.0 |
| flutter_riverpod | 2.6.1 | required | pkg:pub/flutter_riverpod@2.6.1 | apps/mobile/pubspec.lock#flutter_riverpod | pub.dev archive SHA-256 verified by pubspec.lock for flutter_riverpod@2.6.1 |
| riverpod | 2.6.1 | required | pkg:pub/riverpod@2.6.1 | apps/mobile/pubspec.lock#riverpod | pub.dev archive SHA-256 verified by pubspec.lock for riverpod@2.6.1 |
| state_notifier | 1.0.0 | required | pkg:pub/state_notifier@1.0.0 | apps/mobile/pubspec.lock#state_notifier | pub.dev archive SHA-256 verified by pubspec.lock for state_notifier@1.0.0 |
| uuid | 4.6.0 | required | pkg:pub/uuid@4.6.0 | apps/mobile/pubspec.lock#uuid | pub.dev archive SHA-256 verified by pubspec.lock for uuid@4.6.0 |
| ccxt | 4.4.10 | required | pkg:pypi/ccxt@4.4.10 | services/market-data/requirements.txt | PyPI metadata ccxt==4.4.10 |
| fastapi | 0.143.0 | required | pkg:pypi/fastapi@0.143.0 | services/execution-engine/requirements.txt | PyPI metadata fastapi==0.143.0 |
| pydantic-settings | 2.5.2 | required | pkg:pypi/pydantic-settings@2.5.2 | services/market-data/requirements.txt | PyPI metadata pydantic-settings==2.5.2 |
| pydantic | 2.9.2 | required | pkg:pypi/pydantic@2.9.2 | services/market-data/requirements.txt | PyPI metadata pydantic==2.9.2 |
| redis | 5.1.1 | required | pkg:pypi/redis@5.1.1 | services/trading-engine/requirements.txt | PyPI metadata redis==5.1.1 |

### MIT OR Apache-2.0

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| bitflags | 2.13.2 | required | pkg:cargo/bitflags@2.13.2 | packages/sdk-rust/Cargo.lock | crates.io version metadata bitflags@2.13.2 |
| block-buffer | 0.10.4 | required | pkg:cargo/block-buffer@0.10.4 | services/low-latency-gateway/Cargo.lock | crates.io version metadata block-buffer@0.10.4 |
| bumpalo | 3.20.3 | required | pkg:cargo/bumpalo@3.20.3 | services/low-latency-gateway/Cargo.lock | crates.io version metadata bumpalo@3.20.3 |
| cc | 1.4.7 | required | pkg:cargo/cc@1.4.7 | services/low-latency-gateway/Cargo.lock | crates.io version metadata cc@1.4.7 |
| cfg-if | 1.0.5 | required | pkg:cargo/cfg-if@1.0.5 | packages/sdk-rust/Cargo.lock | crates.io version metadata cfg-if@1.0.5 |
| cpufeatures | 0.2.17 | required | pkg:cargo/cpufeatures@0.2.17 | packages/sdk-rust/Cargo.lock | crates.io version metadata cpufeatures@0.2.17 |
| crypto-common | 0.1.7 | required | pkg:cargo/crypto-common@0.1.7 | packages/sdk-rust/Cargo.lock | crates.io version metadata crypto-common@0.1.7 |
| digest | 0.10.7 | required | pkg:cargo/digest@0.10.7 | packages/sdk-rust/Cargo.lock | crates.io version metadata digest@0.10.7 |
| displaydoc | 0.2.7 | required | pkg:cargo/displaydoc@0.2.7 | services/low-latency-gateway/Cargo.lock | crates.io version metadata displaydoc@0.2.7 |
| errno | 0.3.14 | required | pkg:cargo/errno@0.3.14 | services/low-latency-gateway/Cargo.lock | crates.io version metadata errno@0.3.14 |
| find-msvc-tools | 0.1.13 | required | pkg:cargo/find-msvc-tools@0.1.13 | services/low-latency-gateway/Cargo.lock | crates.io version metadata find-msvc-tools@0.1.13 |
| form_urlencoded | 1.2.2 | required | pkg:cargo/form_urlencoded@1.2.2 | services/low-latency-gateway/Cargo.lock | crates.io version metadata form_urlencoded@1.2.2 |
| futures-core | 0.3.34 | required | pkg:cargo/futures-core@0.3.34 | services/low-latency-gateway/Cargo.lock | crates.io version metadata futures-core@0.3.34 |
| futures-macro | 0.3.34 | required | pkg:cargo/futures-macro@0.3.34 | services/low-latency-gateway/Cargo.lock | crates.io version metadata futures-macro@0.3.34 |
| futures-sink | 0.3.34 | required | pkg:cargo/futures-sink@0.3.34 | services/low-latency-gateway/Cargo.lock | crates.io version metadata futures-sink@0.3.34 |
| futures-task | 0.3.34 | required | pkg:cargo/futures-task@0.3.34 | services/low-latency-gateway/Cargo.lock | crates.io version metadata futures-task@0.3.34 |
| futures-util | 0.3.34 | required | pkg:cargo/futures-util@0.3.34 | services/low-latency-gateway/Cargo.lock | crates.io version metadata futures-util@0.3.34 |
| getrandom | 0.2.17 | required | pkg:cargo/getrandom@0.2.17 | services/low-latency-gateway/Cargo.lock | crates.io version metadata getrandom@0.2.17 |
| getrandom | 0.4.3 | required | pkg:cargo/getrandom@0.4.3 | services/low-latency-gateway/Cargo.lock | crates.io version metadata getrandom@0.4.3 |
| hex | 0.4.3 | required | pkg:cargo/hex@0.4.3 | packages/sdk-rust/Cargo.lock | crates.io version metadata hex@0.4.3 |
| hmac | 0.12.1 | required | pkg:cargo/hmac@0.12.1 | packages/sdk-rust/Cargo.lock | crates.io version metadata hmac@0.12.1 |
| http | 1.5.0 | required | pkg:cargo/http@1.5.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata http@1.5.0 |
| httparse | 1.10.1 | required | pkg:cargo/httparse@1.10.1 | services/low-latency-gateway/Cargo.lock | crates.io version metadata httparse@1.10.1 |
| idna | 1.1.0 | required | pkg:cargo/idna@1.1.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata idna@1.1.0 |
| itoa | 1.0.18 | required | pkg:cargo/itoa@1.0.18 | services/low-latency-gateway/Cargo.lock | crates.io version metadata itoa@1.0.18 |
| js-sys | 0.3.105 | required | pkg:cargo/js-sys@0.3.105 | services/low-latency-gateway/Cargo.lock | crates.io version metadata js-sys@0.3.105 |
| lazy_static | 1.5.0 | required | pkg:cargo/lazy_static@1.5.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata lazy_static@1.5.0 |
| libc | 0.2.189 | required | pkg:cargo/libc@0.2.189 | packages/sdk-rust/Cargo.lock | crates.io version metadata libc@0.2.189 |
| lock_api | 0.4.14 | required | pkg:cargo/lock_api@0.4.14 | packages/sdk-rust/Cargo.lock | crates.io version metadata lock_api@0.4.14 |
| log | 0.4.34 | required | pkg:cargo/log@0.4.34 | services/low-latency-gateway/Cargo.lock | crates.io version metadata log@0.4.34 |
| once_cell | 1.21.4 | required | pkg:cargo/once_cell@1.21.4 | services/low-latency-gateway/Cargo.lock | crates.io version metadata once_cell@1.21.4 |
| parking_lot_core | 0.9.12 | required | pkg:cargo/parking_lot_core@0.9.12 | packages/sdk-rust/Cargo.lock | crates.io version metadata parking_lot_core@0.9.12 |
| parking_lot | 0.12.5 | required | pkg:cargo/parking_lot@0.12.5 | packages/sdk-rust/Cargo.lock | crates.io version metadata parking_lot@0.12.5 |
| percent-encoding | 2.3.2 | required | pkg:cargo/percent-encoding@2.3.2 | services/low-latency-gateway/Cargo.lock | crates.io version metadata percent-encoding@2.3.2 |
| ppv-lite86 | 0.2.21 | required | pkg:cargo/ppv-lite86@0.2.21 | services/low-latency-gateway/Cargo.lock | crates.io version metadata ppv-lite86@0.2.21 |
| proc-macro2 | 1.0.107 | required | pkg:cargo/proc-macro2@1.0.107 | services/low-latency-gateway/Cargo.lock | crates.io version metadata proc-macro2@1.0.107 |
| quote | 1.0.47 | required | pkg:cargo/quote@1.0.47 | services/low-latency-gateway/Cargo.lock | crates.io version metadata quote@1.0.47 |
| rand_chacha | 0.3.1 | required | pkg:cargo/rand_chacha@0.3.1 | services/low-latency-gateway/Cargo.lock | crates.io version metadata rand_chacha@0.3.1 |
| rand_core | 0.6.4 | required | pkg:cargo/rand_core@0.6.4 | services/low-latency-gateway/Cargo.lock | crates.io version metadata rand_core@0.6.4 |
| rand | 0.8.8 | required | pkg:cargo/rand@0.8.8 | services/low-latency-gateway/Cargo.lock | crates.io version metadata rand@0.8.8 |
| regex-automata | 0.4.18 | required | pkg:cargo/regex-automata@0.4.18 | services/low-latency-gateway/Cargo.lock | crates.io version metadata regex-automata@0.4.18 |
| regex-syntax | 0.8.11 | required | pkg:cargo/regex-syntax@0.8.11 | services/low-latency-gateway/Cargo.lock | crates.io version metadata regex-syntax@0.8.11 |
| rustls-pki-types | 1.15.1 | required | pkg:cargo/rustls-pki-types@1.15.1 | services/low-latency-gateway/Cargo.lock | crates.io version metadata rustls-pki-types@1.15.1 |
| rustversion | 1.0.23 | required | pkg:cargo/rustversion@1.0.23 | services/low-latency-gateway/Cargo.lock | crates.io version metadata rustversion@1.0.23 |
| scopeguard | 1.2.0 | required | pkg:cargo/scopeguard@1.2.0 | packages/sdk-rust/Cargo.lock | crates.io version metadata scopeguard@1.2.0 |
| serde_core | 1.0.229 | required | pkg:cargo/serde_core@1.0.229 | services/low-latency-gateway/Cargo.lock | crates.io version metadata serde_core@1.0.229 |
| serde_derive | 1.0.229 | required | pkg:cargo/serde_derive@1.0.229 | packages/sdk-rust/Cargo.lock | crates.io version metadata serde_derive@1.0.229 |
| serde_json | 1.0.151 | required | pkg:cargo/serde_json@1.0.151 | services/low-latency-gateway/Cargo.lock | crates.io version metadata serde_json@1.0.151 |
| serde | 1.0.229 | required | pkg:cargo/serde@1.0.229 | services/low-latency-gateway/Cargo.lock | crates.io version metadata serde@1.0.229 |
| sha1 | 0.10.7 | required | pkg:cargo/sha1@0.10.7 | services/low-latency-gateway/Cargo.lock | crates.io version metadata sha1@0.10.7 |
| sha2 | 0.10.9 | required | pkg:cargo/sha2@0.10.9 | services/low-latency-gateway/Cargo.lock | crates.io version metadata sha2@0.10.9 |
| shlex | 2.0.1 | required | pkg:cargo/shlex@2.0.1 | services/low-latency-gateway/Cargo.lock | crates.io version metadata shlex@2.0.1 |
| signal-hook-registry | 1.4.8 | required | pkg:cargo/signal-hook-registry@1.4.8 | packages/sdk-rust/Cargo.lock | crates.io version metadata signal-hook-registry@1.4.8 |
| smallvec | 1.16.1 | required | pkg:cargo/smallvec@1.16.1 | services/low-latency-gateway/Cargo.lock | crates.io version metadata smallvec@1.16.1 |
| socket2 | 0.6.5 | required | pkg:cargo/socket2@0.6.5 | services/low-latency-gateway/Cargo.lock | crates.io version metadata socket2@0.6.5 |
| stable_deref_trait | 1.2.1 | required | pkg:cargo/stable_deref_trait@1.2.1 | services/low-latency-gateway/Cargo.lock | crates.io version metadata stable_deref_trait@1.2.1 |
| syn | 2.0.119 | required | pkg:cargo/syn@2.0.119 | packages/sdk-rust/Cargo.lock | crates.io version metadata syn@2.0.119 |
| syn | 3.0.6 | required | pkg:cargo/syn@3.0.6 | services/low-latency-gateway/Cargo.lock | crates.io version metadata syn@3.0.6 |
| thiserror-impl | 1.0.69 | required | pkg:cargo/thiserror-impl@1.0.69 | packages/sdk-rust/Cargo.lock | crates.io version metadata thiserror-impl@1.0.69 |
| thiserror | 1.0.69 | required | pkg:cargo/thiserror@1.0.69 | packages/sdk-rust/Cargo.lock | crates.io version metadata thiserror@1.0.69 |
| thread_local | 1.1.10 | required | pkg:cargo/thread_local@1.1.10 | services/low-latency-gateway/Cargo.lock | crates.io version metadata thread_local@1.1.10 |
| tokio-rustls | 0.26.5 | required | pkg:cargo/tokio-rustls@0.26.5 | services/low-latency-gateway/Cargo.lock | crates.io version metadata tokio-rustls@0.26.5 |
| tungstenite | 0.24.0 | required | pkg:cargo/tungstenite@0.24.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata tungstenite@0.24.0 |
| typenum | 1.20.1 | required | pkg:cargo/typenum@1.20.1 | packages/sdk-rust/Cargo.lock | crates.io version metadata typenum@1.20.1 |
| url | 2.5.8 | required | pkg:cargo/url@2.5.8 | services/low-latency-gateway/Cargo.lock | crates.io version metadata url@2.5.8 |
| utf-8 | 0.7.6 | required | pkg:cargo/utf-8@0.7.6 | services/low-latency-gateway/Cargo.lock | crates.io version metadata utf-8@0.7.6 |
| version_check | 0.9.5 | required | pkg:cargo/version_check@0.9.5 | packages/sdk-rust/Cargo.lock | crates.io version metadata version_check@0.9.5 |
| wasm-bindgen-macro-support | 0.2.128 | required | pkg:cargo/wasm-bindgen-macro-support@0.2.128 | services/low-latency-gateway/Cargo.lock | crates.io version metadata wasm-bindgen-macro-support@0.2.128 |
| wasm-bindgen-macro | 0.2.128 | required | pkg:cargo/wasm-bindgen-macro@0.2.128 | services/low-latency-gateway/Cargo.lock | crates.io version metadata wasm-bindgen-macro@0.2.128 |
| wasm-bindgen-shared | 0.2.128 | required | pkg:cargo/wasm-bindgen-shared@0.2.128 | services/low-latency-gateway/Cargo.lock | crates.io version metadata wasm-bindgen-shared@0.2.128 |
| wasm-bindgen | 0.2.128 | required | pkg:cargo/wasm-bindgen@0.2.128 | services/low-latency-gateway/Cargo.lock | crates.io version metadata wasm-bindgen@0.2.128 |
| windows_aarch64_gnullvm | 0.52.6 | required | pkg:cargo/windows_aarch64_gnullvm@0.52.6 | services/low-latency-gateway/Cargo.lock | crates.io version metadata windows_aarch64_gnullvm@0.52.6 |
| windows_aarch64_msvc | 0.52.6 | required | pkg:cargo/windows_aarch64_msvc@0.52.6 | services/low-latency-gateway/Cargo.lock | crates.io version metadata windows_aarch64_msvc@0.52.6 |
| windows_i686_gnu | 0.52.6 | required | pkg:cargo/windows_i686_gnu@0.52.6 | services/low-latency-gateway/Cargo.lock | crates.io version metadata windows_i686_gnu@0.52.6 |
| windows_i686_gnullvm | 0.52.6 | required | pkg:cargo/windows_i686_gnullvm@0.52.6 | services/low-latency-gateway/Cargo.lock | crates.io version metadata windows_i686_gnullvm@0.52.6 |
| windows_i686_msvc | 0.52.6 | required | pkg:cargo/windows_i686_msvc@0.52.6 | services/low-latency-gateway/Cargo.lock | crates.io version metadata windows_i686_msvc@0.52.6 |
| windows_x86_64_gnu | 0.52.6 | required | pkg:cargo/windows_x86_64_gnu@0.52.6 | services/low-latency-gateway/Cargo.lock | crates.io version metadata windows_x86_64_gnu@0.52.6 |
| windows_x86_64_gnullvm | 0.52.6 | required | pkg:cargo/windows_x86_64_gnullvm@0.52.6 | services/low-latency-gateway/Cargo.lock | crates.io version metadata windows_x86_64_gnullvm@0.52.6 |
| windows_x86_64_msvc | 0.52.6 | required | pkg:cargo/windows_x86_64_msvc@0.52.6 | services/low-latency-gateway/Cargo.lock | crates.io version metadata windows_x86_64_msvc@0.52.6 |
| windows-link | 0.2.1 | required | pkg:cargo/windows-link@0.2.1 | packages/sdk-rust/Cargo.lock | crates.io version metadata windows-link@0.2.1 |
| windows-sys | 0.52.0 | required | pkg:cargo/windows-sys@0.52.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata windows-sys@0.52.0 |
| windows-sys | 0.61.2 | required | pkg:cargo/windows-sys@0.61.2 | services/low-latency-gateway/Cargo.lock | crates.io version metadata windows-sys@0.61.2 |
| windows-targets | 0.52.6 | required | pkg:cargo/windows-targets@0.52.6 | services/low-latency-gateway/Cargo.lock | crates.io version metadata windows-targets@0.52.6 |

### MIT OR Apache-2.0 OR LGPL-2.1-or-later

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| r-efi | 6.0.0 | required | pkg:cargo/r-efi@6.0.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata r-efi@6.0.0 |

### MIT-0

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| nodemailer | 10.0.16 | required | pkg:npm/nodemailer@10.0.16 | package-lock.json#node_modules/nodemailer | lockfile |

### Python-2.0

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| argparse | 2.0.1 | required | pkg:npm/argparse@2.0.1 | package-lock.json#node_modules/argparse | lockfile |

### Unicode-3.0

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| icu_collections | 2.3.0 | required | pkg:cargo/icu_collections@2.3.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata icu_collections@2.3.0 |
| icu_locale_core | 2.3.0 | required | pkg:cargo/icu_locale_core@2.3.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata icu_locale_core@2.3.0 |
| icu_normalizer_data | 2.3.0 | required | pkg:cargo/icu_normalizer_data@2.3.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata icu_normalizer_data@2.3.0 |
| icu_normalizer | 2.3.0 | required | pkg:cargo/icu_normalizer@2.3.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata icu_normalizer@2.3.0 |
| icu_properties_data | 2.3.0 | required | pkg:cargo/icu_properties_data@2.3.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata icu_properties_data@2.3.0 |
| icu_properties | 2.3.0 | required | pkg:cargo/icu_properties@2.3.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata icu_properties@2.3.0 |
| icu_provider | 2.3.1 | required | pkg:cargo/icu_provider@2.3.1 | services/low-latency-gateway/Cargo.lock | crates.io version metadata icu_provider@2.3.1 |
| litemap | 0.8.3 | required | pkg:cargo/litemap@0.8.3 | services/low-latency-gateway/Cargo.lock | crates.io version metadata litemap@0.8.3 |
| potential_utf | 0.1.6 | required | pkg:cargo/potential_utf@0.1.6 | services/low-latency-gateway/Cargo.lock | crates.io version metadata potential_utf@0.1.6 |
| tinystr | 0.8.4 | required | pkg:cargo/tinystr@0.8.4 | services/low-latency-gateway/Cargo.lock | crates.io version metadata tinystr@0.8.4 |
| writeable | 0.6.4 | required | pkg:cargo/writeable@0.6.4 | services/low-latency-gateway/Cargo.lock | crates.io version metadata writeable@0.6.4 |
| yoke-derive | 0.8.3 | required | pkg:cargo/yoke-derive@0.8.3 | services/low-latency-gateway/Cargo.lock | crates.io version metadata yoke-derive@0.8.3 |
| yoke | 0.8.3 | required | pkg:cargo/yoke@0.8.3 | services/low-latency-gateway/Cargo.lock | crates.io version metadata yoke@0.8.3 |
| zerofrom-derive | 0.1.8 | required | pkg:cargo/zerofrom-derive@0.1.8 | services/low-latency-gateway/Cargo.lock | crates.io version metadata zerofrom-derive@0.1.8 |
| zerofrom | 0.1.8 | required | pkg:cargo/zerofrom@0.1.8 | services/low-latency-gateway/Cargo.lock | crates.io version metadata zerofrom@0.1.8 |
| zerotrie | 0.2.5 | required | pkg:cargo/zerotrie@0.2.5 | services/low-latency-gateway/Cargo.lock | crates.io version metadata zerotrie@0.2.5 |
| zerovec-derive | 0.11.6 | required | pkg:cargo/zerovec-derive@0.11.6 | services/low-latency-gateway/Cargo.lock | crates.io version metadata zerovec-derive@0.11.6 |
| zerovec | 0.11.8 | required | pkg:cargo/zerovec@0.11.8 | services/low-latency-gateway/Cargo.lock | crates.io version metadata zerovec@0.11.8 |

### Unlicense OR MIT

| Package | Version | Scope | Package URL | Source manifest | License evidence |
| --- | --- | --- | --- | --- | --- |
| aho-corasick | 1.1.5 | required | pkg:cargo/aho-corasick@1.1.5 | services/low-latency-gateway/Cargo.lock | crates.io version metadata aho-corasick@1.1.5 |
| byteorder | 1.5.0 | required | pkg:cargo/byteorder@1.5.0 | services/low-latency-gateway/Cargo.lock | crates.io version metadata byteorder@1.5.0 |
| memchr | 2.8.3 | required | pkg:cargo/memchr@2.8.3 | packages/sdk-rust/Cargo.lock | crates.io version metadata memchr@2.8.3 |

## License policy

The release license gate fails closed when a required or optional component has unknown license metadata. GPL, AGPL, and SSPL expressions are denied unless the exact package URL and exact SPDX expression have a reviewed reason in `docs/sale/LICENSE_ALLOWLIST.md`. An allowlist entry is not legal advice or a substitute for counsel review.

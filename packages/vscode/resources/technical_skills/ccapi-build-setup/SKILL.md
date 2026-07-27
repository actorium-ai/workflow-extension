---
name: ccapi-build-setup
description: Build the ccapi C++ Go bindings from the git submodule and configure CGO compiler flags. Required before any CGO_ENABLED=1 build or test in repos that embed ccapi (defi-engine, settlement).
---

# ccapi Build Setup

Repos in this workspace that embed ccapi as a git submodule (`defi-engine`, `settlement`)
must build the C++ bindings with cmake before any CGO-enabled Go build or test can run.
The cmake step generates environment-correct compiler flags — do not hardcode them.

## Prerequisites

Install system packages if not already present (Debian/Ubuntu containers):

```bash
apt-get update && apt-get install -y \
  git build-essential swig cmake libssl-dev zlib1g-dev
```

Verify cmake is present before continuing:

```bash
cmake --version   # must be 3.x or later
```

## Step 1 — Initialise the submodule

```bash
git submodule update --init --recursive
```

## Step 2 — Build the ccapi Go bindings

The first build downloads Boost, RapidJSON, and hffix via CMake FetchContent.
This takes several minutes on first run; subsequent builds are incremental.

```bash
mkdir -p ccapi/binding/build
cd ccapi/binding/build
cmake -DBUILD_GO=ON -DBUILD_VERSION=1.0.0 ..
cmake --build .
cd -
```

## Step 3 — Source CGO compiler flags

```bash
source ./ccapi/binding/build/go/packaging/1.0.0/export_compiler_options.sh
```

This sets `CGO_CXXFLAGS` and `CGO_LDFLAGS` for the current environment.
Do not hardcode these values — they vary by OS and toolchain.

## Step 4 — Build / test with CGO enabled

Full test suite:

```bash
CGO_ENABLED=1 go test ./... -count=1 -timeout 120s
```

Compile check only:

```bash
CGO_ENABLED=1 go build ./...
```

Packages that do not link ccapi:

```bash
CGO_ENABLED=0 go test ./<package>/... -count=1
```

## Common failures

| Symptom | Fix |
|---|---|
| `cmake: command not found` | `apt-get install -y cmake` |
| `swig: command not found` | `apt-get install -y swig` |
| `fatal error: openssl/ssl.h` | `apt-get install -y libssl-dev` |
| `undefined reference to ccapi_...` | Re-run Steps 2–3; flags not sourced |
| FetchContent hangs | Check container network; retry |
| `go: updates to go.mod needed` | Comment out any active local `replace` directive |

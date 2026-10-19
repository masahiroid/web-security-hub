# Local soundness backport

Source: unmodified crates.io `glib` 0.18.5, plus the two-line upstream fix in `src/variant_iter.rs` from https://github.com/gtk-rs/gtk-rs-core/pull/1343.

Archive SHA-256 (also recorded in the previous Cargo.lock): `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`.

Advisory: GHSA-wrw7-89jp-8q8g / RUSTSEC-2024-0429. `VariantStrIter::impl_get` must pass a mutable out-pointer to `g_variant_get_child`. An immutable reference lets optimized builds disregard the write and can cause a null dereference. The fix changes `let p` to `let mut p`, and `&p` to `&mut p`. The crate's original license and copyright files are preserved. Package version and public API remain unchanged to satisfy the GTK3 dependency graph.

Tauri's GTK3 dependency currently requires glib 0.18, preventing a direct move to fixed upstream glib 0.20. Cargo.toml patches crates.io to this source. Remove this directory and patch when the Tauri/GTK dependency graph can resolve a fixed upstream release. Dependency scanners may still flag the version number: inspect the applied patch rather than dismissing the advisory as false for unpatched copies. Existing installer assets are not replaced by this source change. Run the regression in `tests/variant_iter_soundness.rs` in release mode so compiler optimization is exercised.

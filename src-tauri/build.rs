fn main() {
    println!("cargo:rustc-env=WSH_TARGET={}", std::env::var("TARGET").unwrap());
    tauri_build::build()
}

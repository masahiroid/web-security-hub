use glib::variant::ToVariant;

#[test]
fn optimized_string_array_iteration_preserves_the_out_pointer() {
    let expected = ["first", "日本語", "", "last"];
    let value = expected.to_variant();
    let forward: Vec<_> = value.array_iter_str().unwrap().collect();
    let backward: Vec<_> = value.array_iter_str().unwrap().rev().collect();
    assert_eq!(forward, expected);
    assert_eq!(backward, expected.into_iter().rev().collect::<Vec<_>>());
}
